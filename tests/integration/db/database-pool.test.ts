import { Pool } from "pg";
import { trace } from "@opentelemetry/api";
import { expect, it, vi } from "vitest";
import { DatabasePool } from "@/db/pool";
import { logEvent } from "@/lib/observability/logger";
import { localDatabaseUrl } from "./harness/database";

vi.mock("@/lib/observability/logger", () => ({ logEvent: vi.fn() }));

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
    expect(pool.getClientSnapshot().holdMs).toBeGreaterThan(0);
    expect(pool.getClientSnapshot().transactionMs).toBeGreaterThan(0);
  } finally { await pool.end(); }
});

it("keeps real PG results and errors intact when trace creation or span completion throws", async () => {
  const pool = new DatabasePool({ connectionString: localDatabaseUrl(), ssl: false, max: 1 });
  const tracer = vi.spyOn(trace, "getTracer").mockImplementation(() => { throw new Error("fixture exporter unavailable"); });
  try {
    expect((await pool.query("select 42 as n")).rows).toEqual([{ n: 42 }]);
    tracer.mockReturnValue({ startSpan: () => ({ setAttribute() { throw new Error("fixture exporter unavailable"); } }) } as unknown as ReturnType<typeof trace.getTracer>);
    await expect(pool.query("select 1/0")).rejects.toMatchObject({ code: "22012" });
    expect((await pool.query("select 43 as n")).rows).toEqual([{ n: 43 }]);
    expect(pool.getClientSnapshot()).toMatchObject({ queries: 3, failures: 1, checkouts: 3 });
  } finally { tracer.mockRestore(); await pool.end(); }
});

it("records an interleaved real-PG diagnostic for measurement overhead without asserting a noisy latency threshold", async () => {
  const options = { connectionString: localDatabaseUrl(), ssl: false as const, max: 1 };
  const before = new Pool(options); const after = new DatabasePool(options);
  const runs: { implementation: string; statements: number; elapsedMs: number }[] = [];
  try {
    await before.query("select 1"); await after.query("select 1");
    for (let round = 0; round < 10; round++) {
      for (const [name, pool] of round % 2 ? [["after", after], ["before", before]] as const : [["before", before], ["after", after]] as const) {
        const client = await pool.connect(); const start = performance.now();
        try { for (let n = 0; n < 20; n++) await client.query("select 1"); }
        finally { client.release(); }
        runs.push({ implementation: name, statements: 20, elapsedMs: Math.round((performance.now() - start) * 1000) / 1000 });
      }
    }
    expect(after.getClientSnapshot().queries).toBe(201);
    console.info(JSON.stringify({ diagnostic: "pg-client-measurement-overhead", scope: "loopback PostgreSQL; no-op OTel; 10 interleaved batches per implementation; not page LCP or production exporter cost", runs }));
  } finally { await before.end(); await after.end(); }
});
