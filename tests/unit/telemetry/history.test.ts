import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { handle, maintain, type Env } from "../../../workers/telemetry/index";
import { maintainHistory } from "../../../workers/telemetry/history";
import { HistoryData, historyDay, historyDayStart, historyDefaults, historyQuantile, emptyHistoryDistribution, parseHistoryQuery, summarizeHistory, HISTORY_DAY as DAY } from "@/lib/telemetry/history-contract";
import { signTicket } from "@/lib/telemetry/ticket";
import type { TelemetryEvent } from "@/lib/telemetry/protocol";

async function fixture() {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: object): Promise<{ outputFiles: { text: string }[] }> };
  const built = await build({ entryPoints: ["workers/telemetry/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
  const bindings = { SIGNING_KEY: "history-fixture-signing-".repeat(3), ADMIN_KEY: "history-fixture-admin-".repeat(3), DASHBOARD_KEY: "history-fixture-dashboard-".repeat(3), ALLOWED_ORIGIN: "https://rivalhub.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1", SUMMARY_RETENTION_DAYS: "0", HISTORY_RETENTION_DAYS: "90" };
  const mf = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: "2026-07-30", bindings, d1Databases: ["DB"] });
  const db = await mf.getD1Database("DB");
  const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
  await db.batch(schema.map(sql => db.prepare(sql)));
  const env: Env = { ...bindings, DB: db as unknown as Env["DB"] };
  const session = crypto.randomUUID();
  async function post(events: Partial<TelemetryEvent>[], now: number) {
    const ticket = await signTicket({ v: 1, id: crypto.randomUUID(), account: null, role: "user", release: "server-release", environment: "production", origin: env.ALLOWED_ORIGIN, exp: now + DAY }, env.SIGNING_KEY);
    return handle(new Request("https://worker.invalid/v1/batches", { method: "POST", headers: { origin: env.ALLOWED_ORIGIN }, body: JSON.stringify({ v: 1, id: crypto.randomUUID(), ticket, events: events.map(e => ({ id: crypto.randomUUID(), at: now, session, route: "/stats", scene: "site", ...e })) }) }), env, now);
  }
  async function read(now: number, query = "") {
    const response = await handle(new Request("https://worker.invalid/admin/history?" + query, { headers: { authorization: `Bearer ${env.DASHBOARD_KEY}` } }), env, now);
    expect(response.status).toBe(200);
    return HistoryData.parse(await response.json());
  }
  return { mf, db, env, post, read };
}

it("keeps history opt-in, validates filters and limits the dashboard credential to reads", async () => {
  const f = await fixture(); const now = historyDayStart("2026-10-25");
  try {
    expect(parseHistoryQuery({ ...historyDefaults, arbitrary: "secret" })).toBeNull();
    expect(parseHistoryQuery({ days: "365" })).toBeNull();
    expect(parseHistoryQuery({ task: "unknown" })).toBeNull();
    expect(parseHistoryQuery({ eventId: "private-name" })).toBeNull();
    const disabled = await handle(new Request("https://worker.invalid/admin/history", { headers: { authorization: `Bearer ${f.env.DASHBOARD_KEY}` } }), { ...f.env, HISTORY_RETENTION_DAYS: "0" }, now);
    expect(HistoryData.parse(await disabled.json())).toMatchObject({ enabled: false, days: [], retentionDays: 0 });
    for (const [path, method, authorization, expected] of [
      ["/admin/history", "GET", "", 401],
      ["/admin/history", "POST", `Bearer ${f.env.DASHBOARD_KEY}`, 405],
      ["/admin/events", "GET", `Bearer ${f.env.DASHBOARD_KEY}`, 401],
      ["/admin/history?days=100", "GET", `Bearer ${f.env.DASHBOARD_KEY}`, 400],
    ] as const) expect((await handle(new Request("https://worker.invalid" + path, { method, headers: { authorization } }), f.env, now)).status).toBe(expected);
  } finally { await f.mf.dispose(); }
}, 30000);

it("deduplicates latest metric updates in their first day and merges duration buckets across days", async () => {
  const f = await fixture(); const day = historyDayStart("2026-10-25");
  try {
    await maintainHistory(f.env, day);
    const id = crypto.randomUUID();
    expect((await f.post([{ kind: "performance", metricName: "LCP", durationMs: 1250, id, measurement: { v: 1, navigationId: crypto.randomUUID(), clientRelease: "client-a", visibility: "visible" } }], day + 1000)).status).toBe(204);
    await maintainHistory(f.env, day + 2000);
    expect((await f.post([{ kind: "performance", metricName: "LCP", durationMs: 750, id }], day + DAY + 1000)).status).toBe(204);
    expect((await f.post([{ kind: "performance", metricName: "LCP", durationMs: 3200, measurement: { v: 1, navigationId: crypto.randomUUID(), clientRelease: "client-a", visibility: "visible" } }], day + DAY + 2000)).status).toBe(204);
    await maintainHistory(f.env, day + DAY + 3000);
    await maintainHistory(f.env, day + DAY + 4000);
    const data = await f.read(day + DAY + 5000);
    const first = data.days.find(d => d.day === "2026-10-25")!;
    expect(first.complete).toBe(true);
    const persistedDay = await f.db.prepare("SELECT payload FROM history_days WHERE day=?").bind(first.day).first<{ payload: string }>();
    expect(JSON.parse(persistedDay!.payload)[0]).toMatchObject({ n: 1, release: "client-a", duration: { n: 1, sum: 750, min: 750, max: 750 } });
    const merged = summarizeHistory(data).timings.find(t => t.name === "LCP")!;
    expect(merged).toMatchObject({ n: 2, mean: 1975, p50: 1000, p90: 3200 });
    expect(historyQuantile(merged.distribution, .95, "LCP")).toBe(3200);
    const persisted = await f.db.prepare("SELECT sample_key,dimensions FROM history_samples").all();
    expect(JSON.stringify(persisted.results)).not.toContain(id);
    expect(JSON.stringify(persisted.results)).not.toContain("server-release");
    expect((await f.db.prepare("SELECT count(*) AS n FROM history_samples").first())?.n).toBe(2);
  } finally { await f.mf.dispose(); }
}, 30000);

it("attributes cross-midnight outcomes to their start cohort and never counts unmatched outcomes as starts", async () => {
  const f = await fixture(); const day = historyDayStart("2026-10-25");
  try {
    await maintainHistory(f.env, day);
    const operationId = crypto.randomUUID();
    const operation = "player-stats.savePlayerStats";
    expect((await f.post([{ kind: "operation", operation, operationId, phase: "start" }], day + DAY - 1000)).status).toBe(204);
    await maintainHistory(f.env, day + DAY - 500);
    expect((await f.post([{ kind: "operation", operation, operationId, phase: "success", durationMs: 2000 }], day + DAY + 1000)).status).toBe(204);
    expect((await f.post([{ kind: "operation", operation, operationId: crypto.randomUUID(), phase: "unknown", durationMs: 300 }], day + DAY + 2000)).status).toBe(204);
    await maintainHistory(f.env, day + DAY + 3000);
    const data = await f.read(day + DAY + 4000);
    const summary = summarizeHistory(data);
    expect(summary.totals).toMatchObject({ operations: 1, success: 1, unknown: 0, pending: 0 });
    expect(summary.byDay.find(d => d.day === "2026-10-25")).toMatchObject({ operations: 1, success: 1 });
    expect(summary.timings.find(t => t.name === operation && t.phase === "success")).toMatchObject({ n: 1, mean: 2000 });
  } finally { await f.mf.dispose(); }
}, 30000);

it("marks bounded backlog and pauses incomplete, seals before sample expiry, and removes all expired history", async () => {
  const f = await fixture(); const day = historyDayStart("2026-10-25");
  try {
    await maintainHistory(f.env, day);
    for (let i = 1; i <= 17; i++) expect((await f.post([{ kind: "page" }], day + i * 1000)).status).toBe(204);
    await maintainHistory(f.env, day + 18000);
    expect(await f.read(day + 19000)).toMatchObject({ pendingBatches: 1, days: [{ complete: false }] });
    await maintainHistory(f.env, day + 20000);
    expect(summarizeHistory(await f.read(day + 21000)).totals.views).toBe(17);
    await maintainHistory({ ...f.env, HISTORY_RETENTION_DAYS: "0" }, day + 22000);
    await maintainHistory(f.env, day + DAY + 1000);
    expect((await f.read(day + DAY + 2000)).days.every(d => !d.complete)).toBe(true);
    await maintain(f.env, day + 6 * DAY + 1000);
    expect((await f.read(day + 6 * DAY + 2000)).days.find(d => d.day === "2026-10-25")).toMatchObject({ sealed: true, complete: false });
    await maintain(f.env, day + 8 * DAY);
    expect((await f.db.prepare("SELECT count(*) AS n FROM history_samples").first())?.n).toBe(0);
    expect((await f.db.prepare("SELECT count(*) AS n FROM batches").first())?.n).toBe(0);
    await maintain({ ...f.env, HISTORY_RETENTION_DAYS: "0" }, day + 100 * DAY);
    expect((await f.db.prepare("SELECT count(*) AS n FROM history_days").first())?.n).toBe(0);
    expect(historyDay(day)).toBe("2026-10-25");
  } finally { await f.mf.dispose(); }
}, 30000);

it("uses the received start cohort for capped long tasks and late starts", async () => {
  const f = await fixture(); const day = historyDayStart("2026-10-25");
  try {
    await maintainHistory(f.env, day);
    const attemptId = crypto.randomUUID();
    const task = { name: "score_entry" as const, definitionVersion: 1 as const, attemptId, step: "start" as const, phase: "start" as const };
    expect((await f.post([{ kind: "task", task }], day + DAY - 1000)).status).toBe(204);
    await maintainHistory(f.env, day + DAY - 500);
    expect((await f.post([{ kind: "task", task: { ...task, step: "result", phase: "complete", activeMs: 120000 }, durationMs: 3600000 }], day + DAY + 7200000)).status).toBe(204);
    await maintainHistory(f.env, day + DAY + 7201000);
    expect(summarizeHistory(await f.read(day + DAY + 7202000)).byDay.find(d => d.day === "2026-10-25")).toMatchObject({ taskStarts: 1, taskComplete: 1 });
    const operationId = crypto.randomUUID();
    const operation = "player-stats.savePlayerStats";
    expect((await f.post([{ kind: "operation", operation, operationId, phase: "success", durationMs: 3600000 }], day + 2 * DAY + 1000)).status).toBe(204);
    await maintainHistory(f.env, day + 2 * DAY + 1500);
    expect((await f.post([{ kind: "operation", operation, operationId, phase: "start", at: day + 2 * DAY - 1000 }], day + 2 * DAY + 2000)).status).toBe(204);
    await maintainHistory(f.env, day + 2 * DAY + 3000);
    await maintainHistory(f.env, day + 2 * DAY + 3500);
    expect(summarizeHistory(await f.read(day + 2 * DAY + 4000)).byDay.find(d => d.day === "2026-10-27")).toMatchObject({ operations: 1, success: 1 });
  } finally { await f.mf.dispose(); }
}, 30000);

it("keeps raw expiry working before the optional history migration and after aggregate failure", async () => {
  const f = await fixture(); const day = historyDayStart("2026-10-25");
  try {
    expect((await f.post([{ kind: "page" }], day)).status).toBe(204);
    for (const table of ["history_samples", "history_days", "history_gaps", "history_state"]) await f.db.prepare(`DROP TABLE ${table}`).run();
    await expect(maintain({ ...f.env, HISTORY_RETENTION_DAYS: "0" }, day + DAY)).resolves.toBeUndefined();
    await expect(maintain(f.env, day + 7 * DAY)).rejects.toThrow("History migration required");
    expect((await f.db.prepare("SELECT count(*) AS n FROM batches").first())?.n).toBe(0);
  } finally { await f.mf.dispose(); }
}, 30000);


it("bounds all scheduled D1 statements including full expiry cleanup and resume gaps", async () => {
  const f = await fixture(); const day = historyDayStart("2026-10-25"), now = day + 8 * DAY;
  try {
    await maintainHistory(f.env, day);
    expect((await f.post([{ kind: "page" }], day + 1000)).status).toBe(204);
    await f.db.prepare("UPDATE history_state SET paused_at=? WHERE id=1").bind(day + 2000).run();
    for (let i = 1; i <= 16; i++) expect((await f.post([{ kind: "page" }], now + i)).status).toBe(204);
    let statements = 0;
    const counted: Env = { ...f.env, SUMMARY_RETENTION_DAYS: "90", DB: {
      prepare(sql) { statements++; return f.env.DB.prepare(sql); },
      batch(items) { return f.env.DB.batch(items); },
    } };
    await maintain(counted, now + 1000);
    // This fixture needs one raw DELETE; production can execute nine additional
    // chunks. Count each prepared batch statement, not merely D1 batch calls.
    expect(statements + 9).toBeLessThanOrEqual(50);
    expect((await f.db.prepare("SELECT count(*) AS n FROM history_samples").first())?.n).toBe(16);
    expect((await f.db.prepare("SELECT count(*) AS n FROM history_days WHERE captured_at=?").bind(now + 1000).first())?.n).toBeLessThanOrEqual(2);
  } finally { await f.mf.dispose(); }
}, 30000);

it("refreshes live days with short retention instead of revisiting expired candidates forever", async () => {
  const f = await fixture(); const day = historyDayStart("2026-10-25");
  const env = { ...f.env, HISTORY_RETENTION_DAYS: "1" };
  try {
    await maintainHistory(env, day);
    const now = day + 5 * DAY + 1000;
    expect((await f.post([{ kind: "page" }], now)).status).toBe(204);
    for (let i = 1; i <= 4; i++) await maintainHistory(env, now + i * 1000);
    const response = await handle(new Request("https://worker.invalid/admin/history", { headers: { authorization: `Bearer ${env.DASHBOARD_KEY}` } }), env, now + 5000);
    const data = HistoryData.parse(await response.json());
    expect(data.days.find(d => d.day === historyDay(now))?.views).toBe(1);
  } finally { await f.mf.dispose(); }
}, 30000);


it("persists 1200 dimension combinations and returns complete compact 90-day trends after filtering in D1", async () => {
  const f = await fixture(); const day = historyDayStart("2026-07-28");
  try {
    await maintainHistory(f.env, day);
    const samples = Array.from({ length: 1200 }, (_, i) => ({
      key: `capacity-${i}`, dimensions: JSON.stringify({ kind: "performance", name: "LCP", task: "", route: "/stats", scene: "site", role: "user", device: "desktop", release: i === 0 ? "old-release" : "new-release", eventId: `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`, measurementVersion: 1, definitionVersion: 0, navigationType: "navigate" }),
      value: i === 0 ? 500 : 2000, bucket: i === 0 ? 3 : 5,
    }));
    await f.db.prepare(`INSERT INTO history_samples(sample_key,day,kind,dimensions,latest_at,received,expires,closes,has_start,phase,value,bucket,active,active_bucket,client_covered,enhanced_covered)
      SELECT json_extract(value,'$.key'),?,'performance',json_extract(value,'$.dimensions'),?,?,?, ?,0,'',json_extract(value,'$.value'),json_extract(value,'$.bucket'),NULL,0,1,1 FROM json_each(?)`)
      .bind(historyDay(day), day, day, day + 7 * DAY, day + 6 * DAY, JSON.stringify(samples)).run();
    expect((await f.post([{ kind: "page" }], day + 500)).status).toBe(204);
    await maintainHistory(f.env, day + 1000);
    const snapshot = await f.db.prepare("SELECT payload,complete FROM history_days WHERE day=?").bind(historyDay(day)).first<{ payload: string; complete: number }>();
    expect(snapshot?.complete).toBe(1);
    expect(JSON.parse(snapshot!.payload)).toHaveLength(1201);
    expect(new TextEncoder().encode(snapshot!.payload).length).toBeGreaterThan(384 * 1024);
    const days = Array.from({ length: 90 }, (_, i) => historyDay(day + i * DAY));
    await f.db.prepare(`INSERT INTO history_days(day,payload,complete,sealed,captured_at,expires)
      SELECT value,?,1,1,?,? FROM json_each(?) WHERE true ON CONFLICT(day) DO UPDATE SET payload=excluded.payload,complete=1,sealed=1,expires=excluded.expires`)
      .bind(snapshot!.payload, day + 89 * DAY, day + 91 * DAY, JSON.stringify(days)).run();
    const now = day + 89 * DAY + 1000;
    const data = await f.read(now, "days=90");
    expect(data.truncated).toBe(false);
    expect(data.days).toHaveLength(90);
    expect(data.days.every(d => d.complete && d.views === 1)).toBe(true);
    expect(summarizeHistory(data).totals.views).toBe(90);
    expect(data.timingRows).toHaveLength(2);
    expect(data.timingRows.reduce((sum, row) => sum + row.duration.n, 0)).toBe(108000);
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThan(40 * 1024);
    const selected = await f.read(now, "days=90&release=old-release");
    expect(selected.truncated).toBe(false);
    expect(selected.days).toHaveLength(90);
    expect(summarizeHistory(selected).timings[0]).toMatchObject({ release: "old-release", n: 90, mean: 500, p50: 500, p90: 500 });
    const event = await f.read(now, "days=90&eventId=00000000-0000-4000-8000-000000001199");
    expect(summarizeHistory(event).timings[0]).toMatchObject({ n: 90, mean: 2000, p90: 2000 });
  } finally { await f.mf.dispose(); }
}, 60000);

it("limits timing groups after filtering while keeping daily totals complete and merging unequal distributions", async () => {
  const f = await fixture(); const day = historyDayStart("2026-10-25");
  try {
    await maintainHistory(f.env, day);
    const rows = Array.from({ length: 520 }, (_, i) => {
      const duration = emptyHistoryDistribution(); duration.n = 1; duration.sum = 100; duration.min = 100; duration.max = 100; duration.counts[1] = 1;
      return { kind: "performance", name: "LCP", phase: "", release: `release-${i.toString().padStart(4, "0")}`, measurementVersion: 1, definitionVersion: 0, navigationType: "navigate", route: "/stats", scene: "site", role: "user", device: "desktop", eventId: "", task: "", n: 1, starts: 0, clientCovered: 1, enhancedCovered: 1, duration, active: emptyHistoryDistribution() };
    });
    await f.db.prepare("UPDATE history_days SET payload=?,complete=1 WHERE day=?").bind(JSON.stringify(rows), historyDay(day)).run();
    const unfiltered = await f.read(day + 1000);
    expect(unfiltered.truncated).toBe(true);
    expect(unfiltered.timingRows).toHaveLength(512);
    expect(unfiltered.days[0].complete).toBe(true);
    const row = structuredClone(rows[519]); row.n = 9; row.duration = { n: 9, sum: 18000, min: 2000, max: 2000, counts: emptyHistoryDistribution().counts }; row.duration.counts[5] = 9;
    await f.db.prepare("INSERT INTO history_days(day,payload,complete,sealed,captured_at,expires) VALUES(?,?,1,0,?,?)").bind(historyDay(day + DAY), JSON.stringify([row]), day + DAY, day + 91 * DAY).run();
    const selected = await f.read(day + DAY + 1000, "release=release-0519");
    expect(selected.truncated).toBe(false);
    expect(summarizeHistory(selected).timings[0]).toMatchObject({ n: 10, mean: 1810, p50: 2000, p90: 2000 });
  } finally { await f.mf.dispose(); }
}, 30000);
