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
