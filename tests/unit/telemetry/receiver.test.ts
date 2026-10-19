import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { handle, maintain, BUDGET, type Database, type Env, type Statement } from "../../../workers/telemetry/index";
import { signTicket, accountKey } from "@/lib/telemetry/ticket";
import { gunzipSync } from "node:zlib";
import { routeTemplate, safeFilters, type TelemetryEvent, type Ticket } from "@/lib/telemetry/protocol";

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
