import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { handle, maintain, BUDGET, type Database, type Env, type Statement } from "../../../workers/telemetry/index";
import { signTicket, accountKey } from "@/lib/telemetry/ticket";
import { routeTemplate, safeFilters, type TelemetryEvent, type Ticket } from "@/lib/telemetry/protocol";

const now = Date.UTC(2026, 9, 17, 12);
const databases: DatabaseSync[] = [];
/** Execute production SQL against real SQLite, including transaction rollback and changes(). */
function fixture() {
  const sqlite = new DatabaseSync(":memory:"); databases.push(sqlite);
  sqlite.exec(readFileSync("workers/telemetry/schema.sql", "utf8"));
  const wrap = (sql: string, values: (string | number | null)[] = []): Statement => ({
    bind: (...args) => wrap(sql, args),
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...values) as T[] }),
    first: async <T>() => sqlite.prepare(sql).get(...values) as T ?? null,
    run: async () => { sqlite.prepare(sql).run(...values); return {}; },
  });
  const db: Database = { prepare: wrap, batch: async statements => {
    sqlite.exec("BEGIN");
    try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const env: Env = { DB: db, SIGNING_KEY: "test-signing-key-".repeat(3), ADMIN_KEY: "test-admin-key-".repeat(3), ALLOWED_ORIGIN: "https://rivalhub.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1" };
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
    const result = await (await admin(env, `events?session=${body.events[0].session}`)).json();
    expect(result.batches).toHaveLength(1);
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
  it("paginates equal timestamps without losing batches and bounds cleanup to 500 rows", async () => {
    const { env, sqlite } = fixture(); const body = await batch(env);
    await post(env, body);
    const original = sqlite.prepare("SELECT * FROM batches").get()!;
    const insert = sqlite.prepare("INSERT INTO batches SELECT ?,?,received,expires,day,account,session,role,release,environment,bytes,events FROM batches LIMIT 1");
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
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(5);
    await maintain(env, now + 7 * 86400000);
    expect(sqlite.prepare("SELECT count(*) AS n FROM batches").get()?.n).toBe(0);
  });
  it("normalizes all dynamic paths and projects filters without text or credentials", () => {
    expect(routeTemplate("/team-invites/SECRET?token=SECRET")).toBe("/team-invites/[token]");
    expect(routeTemplate("/players/private-id")).toBe("/players/[userId]");
    expect(routeTemplate("/arbitrary/private/path/content")).toBe("/unknown");
    expect(safeFilters(new URLSearchParams("tab=players&q=PRIVATE&token=SECRET&teamFilter=PRIVATE&format=bo3"))).toEqual({ tab: "players", format: "bo3", q: "selected", teamFilter: "selected" });
  });
});
