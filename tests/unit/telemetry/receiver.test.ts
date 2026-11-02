import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, maintain, BUDGET, type Database, type Env, type Statement } from "../../../workers/telemetry/index";
import { TelemetryQueue } from "@/lib/telemetry/queue";
import { signTicket, accountKey } from "@/lib/telemetry/ticket";
import { gunzipSync } from "node:zlib";
import { routeTemplate, safeFilters, validEvent, type TelemetryEvent, type Ticket } from "@/lib/telemetry/protocol";

const now = Date.UTC(2026, 9, 17, 12);
const databases: DatabaseSync[] = [];
/** Execute production SQL against real SQLite, including transaction rollback and changes(). */
function fixture() {
  const sqlite = new DatabaseSync(":memory:"); databases.push(sqlite);
  sqlite.exec(readFileSync("workers/telemetry/schema.sql", "utf8"));
  const wrap = (sql: string, values: (string | number | null | ArrayBuffer)[] = []): Statement => ({
    bind: (...args) => wrap(sql, args),
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...values.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v)) as T[] }),
    first: async <T>() => sqlite.prepare(sql).get(...values.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v)) as T ?? null,
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values.map(v => v instanceof ArrayBuffer ? new Uint8Array(v) : v)).changes) } }),
  });
  const db: Database = { prepare: wrap, batch: async statements => {
    sqlite.exec("BEGIN");
    try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const env: Env = { DB: db, SIGNING_KEY: "test-signing-key-".repeat(3), ADMIN_KEY: "test-admin-key-".repeat(3), ALLOWED_ORIGIN: "https://rivalhub.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1", SUMMARY_RETENTION_DAYS: "14" };
  return { sqlite, env };
}
function event(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return { id: crypto.randomUUID(), at: now, session: crypto.randomUUID(), route: "/[seasonSlug]/bet", scene: "major", kind: "operation", operation: "free-predictions.submitFreePrediction", operationId: crypto.randomUUID(), phase: "success", durationMs: 45, ...overrides };
}
async function batch(env: Env, events = [event()], extra: Partial<Ticket> = {}) {
  const ticket: Ticket = { v: 1, id: crypto.randomUUID(), account: await accountKey("account-fixture", "product-only-key"), role: "user", release: "abc123", environment: "preview", origin: env.ALLOWED_ORIGIN, exp: now + 3600000, ...extra };
  return { v: 1, id: crypto.randomUUID(), ticket: await signTicket(ticket, env.SIGNING_KEY), events };
}
function post(env: Env, body: unknown, time = now, origin = env.ALLOWED_ORIGIN) {
  return handle(new Request("https://receiver.invalid/v1/batches", { method: "POST", headers: { origin }, body: JSON.stringify(body) }), env, time);
}
function admin(env: Env, path: string, time = now) {
  return handle(new Request(`https://receiver.invalid/admin/${path}`, { headers: { authorization: `Bearer ${env.ADMIN_KEY}` } }), env, time);
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("independent receiver privacy, budget and lifecycle", () => {
  it("validates bounded millisecond metrics and persists their existing summary dimensions and expiry", async () => {
    const { env, sqlite } = fixture();
    const sample: TelemetryEvent = { id: crypto.randomUUID(), at: now, session: crypto.randomUUID(), route: "/stats", scene: "site", kind: "performance", metricName: "LCP", durationMs: 1250 };
    expect(validEvent(sample, now)).toBe(true);
    for (const extra of [{ metricName: "PRIVATE" }, { durationMs: NaN }, { durationMs: -1 }, { durationMs: 3600001 }, { durationMs: 1.5 }, { durationMs: undefined }, { navigationURL: "PRIVATE" }, { entries: [] }, { filters: { q: "selected" } }, { operation: "captains.castVote" }]) {
      expect(validEvent({ ...sample, ...extra }, now)).toBe(false);
    }
    expect(validEvent({ ...sample, kind: "page", durationMs: undefined }, now)).toBe(false);
    expect((await post(env, await batch(env, [sample]))).status).toBe(204);
    const stored = sqlite.prepare("SELECT events_gzip,summary,expires FROM batches").get()!;
    expect(JSON.parse(gunzipSync(stored.events_gzip as Uint8Array).toString())).toEqual([sample]);
    expect(JSON.parse(String(stored.summary))).toEqual([["site", "/stats", "performance", "", "", "", "LCP", 1, 1250, null, null, sample.id, sample.at]]);
    expect(stored.expires).toBe(now + 7 * 86400000);
  });
  it("validates unitless CLS and coarse client categories without arbitrary metadata", async () => {
    const { env, sqlite } = fixture();
    const sample: TelemetryEvent = { id: crypto.randomUUID(), at: now, session: crypto.randomUUID(), route: "/", scene: "site", kind: "performance", metricName: "CLS", score: 0.1254,
      client: { device: "mobile", browser: "safari", os: "ios", source: "none" } };
    expect(validEvent(sample, now)).toBe(true);
    for (const extra of [{ score: NaN }, { score: -1 }, { score: 101 }, { score: undefined }, { durationMs: 4 }, { metricName: "LCP" },
      { client: { ...sample.client, userAgent: "PRIVATE" } }, { client: { ...sample.client, source: "PRIVATE" } }, { client: {} }]) {
      expect(validEvent({ ...sample, ...extra }, now)).toBe(false);
    }
    expect(validEvent({ ...sample, kind: "page", metricName: undefined }, now)).toBe(false);
    expect((await post(env, await batch(env, [sample]))).status).toBe(204);
    const stored = sqlite.prepare("SELECT events_gzip,summary FROM batches").get()!;
    expect(JSON.parse(gunzipSync(stored.events_gzip as Uint8Array).toString())).toEqual([sample]);
    expect(JSON.parse(String(stored.summary))).toEqual([["site", "/", "performance", "", "", "", "CLS", 1, 0, 0.1254, sample.client, sample.id, sample.at]]);
    await maintain(env, now + 86400000);
    expect(sqlite.prepare("SELECT count(*) AS n FROM summaries").get()?.n).toBe(0);
  });
  it("keeps category breakdowns within seven-day batches and merges legacy daily dimensions", async () => {
    const { env, sqlite } = fixture(); const session = crypto.randomUUID();
    const samples: TelemetryEvent[] = ["mobile", "desktop"].map(device => ({ id: crypto.randomUUID(), at: now, session, route: "/", scene: "site", kind: "page", client: { device: device as "mobile" | "desktop", browser: "chrome", os: "other", source: "none" } }));
    expect((await post(env, await batch(env, samples))).status).toBe(204);
    const summary = JSON.parse(String(sqlite.prepare("SELECT summary FROM batches").get()?.summary));
    expect(summary).toHaveLength(2);
    expect(summary.map((row: unknown[]) => row[10])).toEqual(samples.map(sample => sample.client));
    await maintain(env, now + 86400000);
    expect(sqlite.prepare("SELECT events FROM summaries").get()?.events).toBe(2);
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM summaries").all())).not.toMatch(/mobile|desktop/);
  });
  it("deduplicates lost ACK retries, reads by account/session, and never persists ingest credentials", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env);
    expect((await post(env, body)).status).toBe(204);
    expect((await post(env, body)).status).toBe(204);
    expect(sqlite.prepare("SELECT batches FROM usage").get()?.batches).toBe(1);
    const stored = sqlite.prepare("SELECT typeof(events_gzip) AS type,events_gzip,summary FROM batches").get()!;
    expect(stored.type).toBe("blob");
    expect(JSON.parse(gunzipSync(stored.events_gzip as Uint8Array).toString())).toEqual(body.events);
    expect(String(stored.summary)).not.toContain(body.events[0].session);
    const result = await (await admin(env, `events?session=${body.events[0].session}`)).json();
    expect(result.batches).toHaveLength(1);
    expect(JSON.parse(result.batches[0].events)).toEqual(body.events);
    expect(JSON.stringify(result)).not.toContain(body.ticket);
    expect((await (await admin(env, `events?account=${result.batches[0].account}`)).json()).batches).toHaveLength(1);
    expect((await handle(new Request("https://receiver.invalid/admin/usage"), env, now)).status).toBe(401);
    expect((await post(env, body, now, "https://foreign.invalid")).status).toBe(403);
    expect((await post(env, { ...body, ticket: body.ticket.slice(0, -5) + "abcde" })).status).toBe(401);
  });
  it("fails closed on unexpected payload, arbitrary errors, stale timestamps and disabled retention", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env);
    expect((await post(env, { ...body, input: "private text" })).status).toBe(400);
    expect((await post(env, { ...body, events: [{ ...body.events[0], message: "private text" }] })).status).toBe(400);
    expect((await post(env, { ...body, events: [{ ...body.events[0], errorCode: "PRIVATE_SECRET" }] })).status).toBe(400);
    expect((await post(env, { ...body, events: [{ ...body.events[0], at: now - 900001 }] })).status).toBe(400);
    expect((await post({ ...env, RETENTION_APPROVED: "0" }, body)).status).toBe(503);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(0);
  });
  it("does not admit an in-flight old-day request after that day's rollup closes", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env);
    sqlite.prepare("INSERT INTO rollups(day) VALUES(?)").run("2026-10-17");
    expect((await post(env, body)).status).toBe(429);
    expect(sqlite.prepare("SELECT batches FROM usage").get()?.batches).toBe(0);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(0);
  });
  it("atomically refuses admission at the daily budget without increasing counters", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env);
    sqlite.prepare("INSERT INTO usage(day,batches,bytes) VALUES(?,?,0)").run("2026-10-17", BUDGET.batches);
    expect((await post(env, body)).status).toBe(429);
    expect(sqlite.prepare("SELECT batches FROM usage").get()?.batches).toBe(BUDGET.batches);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(0);
  });
  it("rolls up closed days once, excludes identities, refuses expired reads, and deletes in bounded retries", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env);
    await post(env, body);
    await maintain(env, now + 86400000);
    await maintain(env, now + 86400000);
    const summary = sqlite.prepare("SELECT * FROM summaries").all();
    expect(summary).toHaveLength(1); expect(summary[0].events).toBe(1);
    expect(summary[0]).not.toHaveProperty("account"); expect(summary[0]).not.toHaveProperty("session");
    const expired = await (await admin(env, `events?session=${body.events[0].session}`, now + 7 * 86400000)).json();
    expect(expired.batches).toHaveLength(0);
    await maintain(env, now + 7 * 86400000);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(0);
    expect(sqlite.prepare("SELECT events FROM summaries").get()?.events).toBe(1);
    await maintain(env, now + 91 * 86400000);
    expect(sqlite.prepare("SELECT count(*) AS n FROM summaries").get()?.n).toBe(0);
  });
  it("rolls back admission when counter persistence fails", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env);
    sqlite.exec("CREATE TRIGGER fail_counter BEFORE UPDATE ON usage BEGIN SELECT RAISE(ABORT,'fixture'); END;");
    expect((await post(env, body)).status).toBe(503);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(0);
  });
  it("commits expiry even when rollup persistence fails, then retries the rollup without expired input", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env);
    await post(env, body);
    const expiredId = crypto.randomUUID();
    sqlite.prepare("INSERT INTO batches SELECT ticket,?,received,?,day,account,session,role,release,environment,bytes,events_gzip,summary FROM batches LIMIT 1").run(expiredId, now);
    sqlite.exec("CREATE TRIGGER fail_rollup BEFORE INSERT ON summaries BEGIN SELECT RAISE(ABORT,'fixture full'); END;");
    await expect(maintain(env, now + 86400000)).rejects.toThrow();
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches WHERE id=?").get(expiredId)?.n).toBe(0);
    expect(sqlite.prepare("SELECT count(*) AS n FROM rollups").get()?.n).toBe(0);
    sqlite.exec("DROP TRIGGER fail_rollup");
    await maintain(env, now + 86400000);
    expect(sqlite.prepare("SELECT events FROM summaries").get()?.events).toBe(1);
    sqlite.exec("CREATE TRIGGER fail_summary_cleanup BEFORE DELETE ON summaries BEGIN SELECT RAISE(ABORT,'fixture delete failure'); END;");
    await expect(maintain(env, now + 91 * 86400000)).rejects.toThrow();
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(0);
    sqlite.exec("DROP TRIGGER fail_summary_cleanup");
    await maintain(env, now + 91 * 86400000);
    expect(sqlite.prepare("SELECT count(*) AS n FROM summaries").get()?.n).toBe(0);
  });
  it("paginates equal timestamps without losing batches and drains concentrated expiry across bounded chunks", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env);
    await post(env, body);
    const original = sqlite.prepare("SELECT * FROM batches").get()!;
    const insert = sqlite.prepare("INSERT INTO batches SELECT ?,?,received,expires,day,account,session,role,release,environment,bytes,events_gzip,summary FROM batches LIMIT 1");
    for (let i = 0; i < 504; i++) insert.run(crypto.randomUUID(), crypto.randomUUID());
    const found = new Set<string>(); let cursor = "";
    do {
      const page = await (await admin(env, `events?session=${body.events[0].session}${cursor}`)).json();
      for (const row of page.batches) { expect(found.has(row.id)).toBe(false); found.add(row.id); }
      cursor = page.nextCursor ? `&${new URLSearchParams(page.nextCursor)}` : "";
    } while (cursor);
    expect(found.size).toBe(505);
    expect(original.session).toBe(body.events[0].session);
    await maintain(env, now + 7 * 86400000);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(0);
    await maintain(env, now + 7 * 86400000);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(0);
  });
  it("normalizes all dynamic paths and projects filters without text or credentials", () => {
    expect(routeTemplate("/team-invites/SECRET?token=SECRET")).toBe("/team-invites/[token]");
    expect(routeTemplate("/admin/private-event/announcements/new")).toBe("/admin/[seasonSlug]/announcements/new");
    expect(routeTemplate("/admin/private-event/announcements/private-id")).toBe("/admin/[seasonSlug]/announcements/[announcementId]");
    expect(routeTemplate("/admin/operations/announcements/new")).toBe("/admin/operations/announcements/new");
    expect(routeTemplate("/admin/private-event/information")).toBe("/admin/[seasonSlug]/information");
    expect(safeFilters(new URLSearchParams("view=materials&ops=conflict&stage=stage1&team=PRIVATE"))).toEqual({ ops: "conflict", stage: "stage1", view: "materials", team: "selected" });
    expect(routeTemplate("/players/private-id")).toBe("/players/[userId]");
    expect(routeTemplate("/arbitrary/private/path/content")).toBe("/unknown");
    expect(safeFilters(new URLSearchParams("tab=players&q=PRIVATE&token=SECRET&teamFilter=PRIVATE&format=bo3"))).toEqual({ tab: "players", format: "bo3", q: "selected", teamFilter: "selected" });
  });
  it("accepts traffic during concentrated expiry and cleanup failure without exposing expired rows", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env); await post(env, body);
    const clone = sqlite.prepare("INSERT INTO batches SELECT ticket,?,?,?,day,account,session,role,release,environment,bytes,events_gzip,summary FROM batches LIMIT 1");
    for (let i = 0; i < 5505; i++) clone.run(crypto.randomUUID(), now - 7 * 86400000, now - 1);
    expect((await post(env, { ...body, id: crypto.randomUUID() })).status).toBe(204);
    await maintain(env, now);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches WHERE expires<=?").get(now)?.n).toBe(505);
    sqlite.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON batches BEGIN SELECT RAISE(ABORT,'fixture unavailable'); END;");
    await expect(maintain(env, now)).rejects.toThrow();
    expect((await post(env, { ...body, id: crypto.randomUUID() })).status).toBe(204);
    const read = await (await admin(env, `events?session=${body.events[0].session}`)).json();
    expect(read.batches).toHaveLength(3);
    expect((await (await admin(env, "usage")).json()).cleanup.expiredBatches).toBe(505);
    sqlite.exec("DROP TRIGGER fail_cleanup"); await maintain(env, now);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches WHERE expires<=?").get(now)?.n).toBe(0);
  });
  it("requires separate summary retention, preserves the approved expiry, and cleans even after summaries are disabled", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env); await post(env, body);
    for (const days of [undefined, "0", "invalid", "91"]) await maintain({ ...env, SUMMARY_RETENTION_DAYS: days }, now + 86400000);
    expect(sqlite.prepare("SELECT count(*) AS n FROM summaries").get()?.n).toBe(0);
    expect(sqlite.prepare("SELECT count(*) AS n FROM rollups").get()?.n).toBe(0);
    await maintain({ ...env, SUMMARY_RETENTION_DAYS: "2" }, now + 86400000);
    const expires = Number(sqlite.prepare("SELECT expires FROM summaries").get()?.expires);
    await maintain({ ...env, SUMMARY_RETENTION_DAYS: "90" }, now + 86400000);
    expect(Number(sqlite.prepare("SELECT expires FROM summaries").get()?.expires)).toBe(expires);
    expect((await (await admin(env, "summary?from=2026-10-17&to=2026-10-18", expires)).json()).rows).toHaveLength(0);
    await maintain({ ...env, SUMMARY_RETENTION_DAYS: undefined }, expires);
    expect(sqlite.prepare("SELECT count(*) AS n FROM summaries").get()?.n).toBe(0);
  });
  it("round-trips a full compressed batch and aggregates counts/durations without retaining raw fields twice", async () => {
    const { env, sqlite } = fixture(); const session = crypto.randomUUID();
    const events = Array.from({ length: 32 }, (_, index) => event({ session, phase: index < 16 ? "success" : "rejected" }));
    const body = await batch(env, events); expect((await post(env, body)).status).toBe(204);
    const stored = sqlite.prepare("SELECT events_gzip,summary FROM batches").get()!;
    expect((stored.events_gzip as Uint8Array).byteLength).toBeLessThan(Buffer.byteLength(JSON.stringify(events)));
    expect(JSON.parse((await (await admin(env, `events?session=${session}`)).json()).batches[0].events)).toEqual(events);
    for (const e of events) expect(String(stored.summary)).not.toContain(e.operationId);
    await maintain(env, now + 86400000);
    expect(sqlite.prepare("SELECT phase,events,duration_ms FROM summaries ORDER BY phase").all()).toEqual([
      { phase: "rejected", events: 16, duration_ms: 720 }, { phase: "success", events: 16, duration_ms: 720 },
    ]);
  });
  it("accepts a 26-hour active tab with a rolling quota and one renewed ticket, while limiting bursts", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env, [event()], { exp: now + 86400000 });
    const renewal = await batch(env, body.events, { exp: now + 44 * 3600000 });
    for (let minute = 0; minute < 26 * 60; minute++) {
      const time = now + minute * 60000;
      const input = { ...body, ticket: minute < 20 * 60 ? body.ticket : renewal.ticket, id: crypto.randomUUID(), events: [{ ...body.events[0], id: crypto.randomUUID(), at: time }] };
      expect((await post(env, input, time)).status).toBe(204);
    }
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(1560);
    const burst = await batch(env, [event()], { exp: now + 86400000 });
    for (let n = 0; n < 120; n++) expect((await post(env, { ...burst, id: crypto.randomUUID() })).status).toBe(204);
    expect((await post(env, { ...burst, id: crypto.randomUUID() })).status).toBe(429);
    const later = now + 3600000;
    // Old hourly traffic no longer exhausts the same ticket.
    expect((await post(env, { ...burst, id: crypto.randomUUID(), events: [{ ...burst.events[0], at: later }] }, later)).status).toBe(204);
  });
});

it("accepts old events and bounded ready/error extensions while rejecting arbitrary diagnostic fields", async () => {
  const { env, sqlite } = fixture();
  const measurement = { v: 1 as const, navigationId: crypto.randomUUID(), clientRelease: "fixture-client", visibility: "visible" as const };
  const ready: TelemetryEvent = { id: crypto.randomUUID(), at: now, session: crypto.randomUUID(), route: "/stats", scene: "site", kind: "ready", measurement, ready: { module: "statistics", phase: "primary" }, durationMs: 123 };
  expect(validEvent(ready, now)).toBe(true);
  for (const extra of [{ measurement: { ...measurement, url: "PRIVATE" } }, { measurement: { ...measurement, clientRelease: "https://private.invalid" } }, { ready: { module: "PRIVATE", phase: "primary" } }, { ready: { ...ready.ready, text: "PRIVATE" } }, { measurement: undefined }, { clientError: { source: "boundary", category: "Error" } }]) expect(validEvent({ ...ready, ...extra }, now)).toBe(false);
  expect((await post(env, await batch(env, [ready]))).status).toBe(204);
  const row = sqlite.prepare("SELECT events_gzip, summary FROM batches").get() as { events_gzip: Uint8Array; summary: string };
  expect(JSON.parse(row.summary)).toEqual([]);
  expect(JSON.parse(gunzipSync(row.events_gzip).toString())[0]).toEqual(ready);
});

it("bounds lifecycle and fingerprint extensions without accepting arbitrary diagnostic payloads", () => {
  const measurement = { v: 1, navigationId: crypto.randomUUID(), clientRelease: "fixture", visibility: "visible", lifecycle: { navigationType: "bfcache", startedHidden: false, resumed: true, startMs: 123, activationMs: 0 } };
  const sample = event({ kind: "error", operation: undefined, operationId: undefined, phase: undefined, durationMs: undefined, errorCode: "CLIENT_UNHANDLED", clientError: { source: "window_error", category: "TypeError", fingerprint: "s1:0123456789abcdef" } });
  expect(validEvent({ ...sample, measurement }, now)).toBe(true);
  for (const lifecycle of [{ ...measurement.lifecycle, url: "PRIVATE" }, { ...measurement.lifecycle, startMs: -1 }, { ...measurement.lifecycle, activationMs: Infinity }, { ...measurement.lifecycle, navigationType: "PRIVATE" }, { ...measurement.lifecycle, resumed: "yes" }]) expect(validEvent({ ...sample, measurement: { ...measurement, lifecycle } }, now)).toBe(false);
  for (const clientError of [{ ...sample.clientError, stack: "PRIVATE" }, { ...sample.clientError, fingerprint: "PRIVATE" }]) expect(validEvent({ ...sample, clientError }, now)).toBe(false);
});


it("accepts v1/v2 and ready basis while rejecting unbounded or falsely censored extensions", async () => {
  const { env, sqlite } = fixture(); const session = crypto.randomUUID();
  const task = { name: "registration" as const, definitionVersion: 2 as const, attemptId: crypto.randomUUID(), phase: "complete" as const, step: "confirm" as const, activeMs: 3600000, elapsedCensored: true as const, activeCensored: true as const };
  const sample = event({ session, kind: "task", operation: undefined, operationId: undefined, phase: undefined, durationMs: 3600000, task });
  expect(validEvent(sample, now)).toBe(true);
  const operation = event({ session, durationMs: 100, task: { ...task, phase: "step" } });
  expect(validEvent(operation, now)).toBe(true);
  expect((await post(env, await batch(env, [operation]))).status).toBe(204);
  for (const extra of [{ task: { ...task, definitionVersion: 1 } }, { task: { ...task, definitionVersion: 3 } }, { task: { ...task, activeCensored: false } }, { durationMs: 3600001 }, { durationMs: 10 }, { task: { ...task, activeMs: 10 } }, { task: { ...task, text: "PRIVATE" } }]) expect(validEvent({ ...sample, ...extra }, now)).toBe(false);
  const ready = event({ session, kind: "ready", operation: undefined, operationId: undefined, phase: undefined, durationMs: 10, ready: { module: "match", phase: "advanced", basis: "demand" }, measurement: { v: 1, navigationId: crypto.randomUUID(), clientRelease: "fixture", visibility: "visible" } });
  expect(validEvent(ready, now)).toBe(true);
  expect(validEvent({ ...ready, ready: { ...ready.ready, basis: "PRIVATE" } }, now)).toBe(false);
  const body = await batch(env, [sample, ready]);
  expect((await post(env, body)).status).toBe(204);
  const stored = sqlite.prepare("SELECT events_gzip FROM batches WHERE id=?").get(body.id)!;
  expect(JSON.parse(gunzipSync(stored.events_gzip as Uint8Array).toString())).toEqual([sample, ready]);
});

it("delivers legal rich batches through queue/receiver and deduplicates a lost ACK", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  try {
    const { env, sqlite } = fixture(); const session = crypto.randomUUID();
    const signed = await batch(env);
    const statuses: number[] = []; let lost = false;
    const send = vi.fn<typeof fetch>(async (_url, init) => {
      const response = await handle(new Request("https://receiver.invalid/v1/batches", { ...init, headers: { origin: env.ALLOWED_ORIGIN } }), env, Date.now());
      statuses.push(response.status);
      if (!lost && response.ok) { lost = true; throw new Error("lost ACK"); }
      return response;
    });
    const q = new TelemetryQueue({ endpoint: "https://receiver.invalid/v1/batches", ticket: signed.ticket, identity: "fixture", expiresAt: now + 3600000 }, send);
    const filters = safeFilters(new URLSearchParams({ tab: "players", ops: "conflict", position: "all", stage: "playoffs", source: "official", sort: "ratingPro", order: "desc", side: "all", status: "finished", map: "de_mirage", view: "leaderboard", format: "bo3", mapsView: "pool", mapFilter: "de_anubis", q: "PRIVATE", search: "PRIVATE", team: "PRIVATE", event: "PRIVATE", player: "PRIVATE", weapon: "PRIVATE", minMaps: "10", teamFilter: "PRIVATE", recordPage: "1" }));
    const samples = Array.from({ length: 33 }, () => event({ session, filters,
      client: { device: "mobile", browser: "safari", os: "ios", source: "none" },
      measurement: { v: 1, navigationId: crypto.randomUUID(), clientRelease: "a".repeat(80), clientVersion: "v2.24.3", visibility: "hidden", lifecycle: { navigationType: "bfcache", startedHidden: false, resumed: true, startMs: 86400000, activationMs: 0 } },
    }));
    expect(samples.every(e => validEvent(e, now))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify({ ...signed, events: samples.slice(0, 32) }))).toBeGreaterThan(24576);
    samples.forEach(e => q.add(e));
    for (let i = 0; i < 6; i++) { await q.flush(); vi.advanceTimersByTime(60000); }
    expect(statuses.every(s => s === 204)).toBe(true);
    expect(send.mock.calls[0][1]?.body).toBe(send.mock.calls[1][1]?.body);
    const rows = sqlite.prepare("SELECT events_gzip FROM batches").all();
    expect(rows.flatMap(r => JSON.parse(gunzipSync(r.events_gzip as Uint8Array).toString()))).toHaveLength(33);
    expect(q.metrics.dropped).toBe(0);
    expect(Number(sqlite.prepare("SELECT batches FROM usage").get()?.batches)).toBe(statuses.length - 1);
  } finally { vi.useRealTimers(); }
});
