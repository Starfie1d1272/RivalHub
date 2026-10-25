import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { handle, maintain, type Env } from "../../../workers/telemetry/index";
import { maintainHistory } from "../../../workers/telemetry/history";
import { HistoryData, historyDay, historyDayStart, historyDefaults, historyQuantile, parseHistoryQuery, summarizeHistory, HISTORY_DAY as DAY } from "@/lib/telemetry/history-contract";
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
    const row = first.rows.find(r => r.name === "LCP")!;
    expect(row).toMatchObject({ n: 1, release: "client-a", duration: { n: 1, sum: 750, min: 750, max: 750 } });
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
