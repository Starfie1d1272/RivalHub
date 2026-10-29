import { Client, Pool } from "pg";
import { expect, it, vi } from "vitest";
import { DatabasePool } from "@/db/pool";
import { logEvent } from "@/lib/observability/logger";
import { localDatabaseUrl } from "./harness/database";
import { db } from "@/db/client";

vi.mock("@/lib/observability/logger", () => ({ logEvent: vi.fn(), captureException: vi.fn() }));

it("shares a real PG replacement across module graphs and drains an old transaction without replay", async () => {
  const a = await import("@/db/client-runtime");
  vi.resetModules();
  const b = await import("@/db/client-runtime");
  const client = (runtime: typeof a) => (runtime.db as unknown as { $client: Pool }).$client;
  const old = client(a);
  expect(client(b)).toBe(old);
  const generation = a.getDatabasePoolSnapshot()!.generation;
  const held = await old.connect();
  let released = false;
  try {
    await held.query("BEGIN");
    await held.query("select 17 as n");
    // Explicit fixture idle-error injection, not a real unknown commit.
    old.emit("error", Object.assign(new Error("fixture idle disconnect"), { code: "ECONNRESET" }));
    old.emit("error", Object.assign(new Error("fixture concurrent disconnect"), { code: "ECONNRESET" }));
    await vi.waitFor(() => expect(a.getDatabasePoolSnapshot()!.generation).toBe(generation + 1));
    const replacement = client(b);
    expect(replacement).not.toBe(old);
    expect(client(a)).toBe(replacement);
    expect(replacement.listenerCount("error")).toBe(1);
    expect((await replacement.query("select 23 as n")).rows).toEqual([{ n: 23 }]);
    expect((await held.query("select 19 as n")).rows).toEqual([{ n: 19 }]);
    expect(a.getDatabasePoolSnapshot()!.retiring.total).toBeGreaterThan(0);
    old.emit("error", Object.assign(new Error("fixture retired event"), { code: "ECONNRESET" }));
    expect(a.getDatabasePoolSnapshot()!.generation).toBe(generation + 1);
    await held.query("COMMIT"); held.release(); released = true;
    await vi.waitFor(() => expect(a.getDatabasePoolSnapshot()!.rebuilding).toBe(false));
    expect(a.getDatabasePoolSnapshot()!.retiring.total).toBe(0);
    expect((await replacement.query("select 29 as n")).rows).toEqual([{ n: 29 }]);
    expect(replacement.listenerCount("error")).toBe(1);
  } finally {
    if (!released) { await held.query("ROLLBACK").catch(() => {}); held.release(); }
    await Promise.all([a.disposeDatabaseBinding(), b.disposeDatabaseBinding()]);
  }
});

it("preserves the runtime owner's real pooled callback return and error channels", async () => {
  const pool = (db as unknown as { $client: Pool }).$client;
  expect(pool.listenerCount("error")).toBe(1);
  const callback = vi.fn();
  await new Promise<void>((resolve, reject) => {
    const returned = pool.query("select $1::int as n", [41], (error, result) => {
      callback();
      if (error) return reject(error);
      try { expect(result.rows).toEqual([{ n: 41 }]); resolve(); } catch (failure) { reject(failure); }
    });
    expect(returned).toBeUndefined();
  });
  await new Promise<void>((resolve, reject) => {
    const returned = pool.query("select 1/0", error => {
      callback();
      try { expect(error).toMatchObject({ code: "22012" }); resolve(); } catch (failure) { reject(failure); }
    });
    expect(returned).toBeUndefined();
  });
  expect(callback).toHaveBeenCalledTimes(2);
  expect(pool.listenerCount("error")).toBe(1);
});

// Real pg-pool checkout: a timed-out queued write must never run after release.
it("preserves promise/callback checkout, removes timed-out work and keeps the pool usable", async () => {
  const pool = new DatabasePool({ connectionString: localDatabaseUrl(), ssl: false, max: 1, connectionTimeoutMillis: 1000 });
  try {
    const held = await pool.connect();
    try {
      await held.query("create temporary table checkout_probe(value integer)");
      pool.options.connectionTimeoutMillis = 50;
      await expect(pool.query("insert into checkout_probe values (1)")).rejects.toThrow("timeout exceeded when trying to connect");
      expect(pool.waitingCount).toBe(0);
      expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "db.pool.acquire", safeContext: {
        poolTotal: 1, poolIdle: 0, poolWaiting: 0, poolMax: 1, connectionState: "queued", outcome: "failure",
      } }));
    } finally { held.release(); }
    const values = await pool.query("select * from checkout_probe");
    expect(values.rows).toEqual([]);
    await new Promise<void>((resolve, reject) => pool.connect((error, client, release) => {
      if (error) { reject(error); return; }
      expect(client).toBeDefined();
      release();
      resolve();
    }));
    expect((await pool.query("select 42 as answer")).rows).toEqual([{ answer: 42 }]);
    expect(pool.totalCount).toBe(1);
    expect(pool.idleCount).toBe(1);
    const acquire = pool.getAcquireSnapshot();
    expect(acquire).toMatchObject({ count: 5, failures: 1, states: { connect: 1, queued: 1, reuse: 3 } });
    expect(acquire.buckets.reduce((sum, count) => sum + count, 0)).toBe(acquire.count);
    expect(acquire.totalMs).toBeGreaterThanOrEqual(acquire.maxMs);
    expect(acquire.waitingPeak).toBe(1);
    expect(acquire.waitingTotal).toBe(1);
    expect(acquire.waitingSamples).toBe(5);
    expect(acquire.waitingBuckets).toEqual([4, 1, 0, 0, 0]);
    acquire.waitingBuckets.fill(999);
    expect(pool.getAcquireSnapshot().waitingBuckets).toEqual([4, 1, 0, 0, 0]);
    acquire.states.reuse = 999;
    acquire.buckets.fill(999);
    expect(pool.getAcquireSnapshot().states.reuse).toBe(3);
    expect(pool.getAcquireSnapshot().buckets.reduce((sum, count) => sum + count, 0)).toBe(5);
  } finally { await pool.end(); }
});

it("counts statements once across pooled and checked-out callback/promise queries and observes transaction/release boundaries", async () => {
  const pool = new DatabasePool({ connectionString: localDatabaseUrl(), ssl: false, max: 1 });
  try {
    await pool.query("select 1");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SAVEPOINT fixture");
      await expect(client.query("select 1/0")).rejects.toMatchObject({ code: "22012" });
      await client.query("ROLLBACK TO SAVEPOINT fixture");
      expect(pool.getClientSnapshot().transactions).toBe(0);
      await new Promise<void>((resolve, reject) => client.query("select $1::int as n", [42], (error, result) => {
        if (error) return reject(error);
        expect(result.rows[0].n).toBe(42); resolve();
      }));
      await client.query("COMMIT;");
      expect(pool.getClientSnapshot()).toMatchObject({ queries: 7, failures: 1, transactions: 1, committed: 1, rolledBack: 0, checkouts: 1 });
    } finally { client.release(); }
    expect(() => client.release()).toThrow("Release called on client which has already been released");
    // Reusing the same client must not stack wrappers or count a query twice.
    await pool.query("select 2");
    expect(pool.getClientSnapshot()).toMatchObject({ queries: 8, failures: 1, transactions: 1, checkouts: 3, unsupported: 0 });
    const next = await pool.connect();
    try {
      await next.query("BEGIN");
      await expect(next.query("select 1/0")).rejects.toMatchObject({ code: "22012" });
      // PostgreSQL treats COMMIT of an aborted transaction as ROLLBACK.
      await next.query("COMMIT");
    } finally { next.release(); }
    expect(pool.getClientSnapshot()).toMatchObject({ queries: 11, transactions: 2, committed: 1, rolledBack: 1, unfinished: 0, checkouts: 4 });
    const leases = pool.getClientSnapshot();
    expect(leases.inFlight).toBe(0);
    expect(leases.peak).toBe(1);
    expect(leases.holdBuckets.reduce((sum, n) => sum + n, 0)).toBe(leases.checkouts);
    expect(leases.holdMaxMs).toBeGreaterThan(0);
    leases.holdBuckets.fill(999);
    expect(pool.getClientSnapshot().holdBuckets.reduce((sum, n) => sum + n, 0)).toBe(leases.checkouts);
    expect(pool.getClientSnapshot().holdMs).toBeGreaterThan(0);
    expect(pool.getClientSnapshot().transactionMs).toBeGreaterThan(0);
  } finally { await pool.end(); }
});


it("restores inherited query dispatch so later driver instrumentation and fault injection remain observable", async () => {
  const pool = new DatabasePool({ connectionString: localDatabaseUrl(), ssl: false, max: 1 });
  try {
    const first = await pool.connect();
    first.release();
    expect(Object.hasOwn(first, "query")).toBe(false);
    const spy = vi.spyOn(Client.prototype, "query");
    try {
      expect((await pool.query("select 42 as n")).rows).toEqual([{ n: 42 }]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(Object.hasOwn(first, "query")).toBe(false);
    } finally { spy.mockRestore(); }
  } finally { await pool.end(); }
});

it("attributes queued pooled queries to their submitting contexts", async () => {
  const { withDbTrafficSource, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const previousEndpoint = process.env.PRODUCT_TELEMETRY_ENDPOINT;
  const previousKey = process.env.DB_TRAFFIC_KEY;
  process.env.PRODUCT_TELEMETRY_ENDPOINT = "https://telemetry.invalid/v1/batches";
  process.env.DB_TRAFFIC_KEY = "fixture-key".repeat(4);
  const sent: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { sent.push(init.body); return new Response(null, { status: 204 }); }));
  const pool = new DatabasePool({ connectionString: localDatabaseUrl(), ssl: false, max: 1 });
  try {
    const held = await pool.connect();
    const first = withDbTrafficSource("mizar", () => pool.query("select 1"));
    const second = withDbTrafficSource("dak", () => pool.query("select 2"));
    withDbTrafficSource("bet.fill", () => held.release());
    await Promise.all([first, second]);
    flushDbTraffic();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const batch = JSON.parse(sent[0]);
    expect(batch.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "mizar", template: "select", queries: 1 }),
      expect.objectContaining({ source: "dak", template: "select", queries: 1 }),
    ]));
    expect(sent[0]).not.toContain("select 1");
  } finally {
    await pool.end();
    if (previousEndpoint === undefined) delete process.env.PRODUCT_TELEMETRY_ENDPOINT; else process.env.PRODUCT_TELEMETRY_ENDPOINT = previousEndpoint;
    if (previousKey === undefined) delete process.env.DB_TRAFFIC_KEY; else process.env.DB_TRAFFIC_KEY = previousKey;
    vi.unstubAllGlobals();
  }
});
