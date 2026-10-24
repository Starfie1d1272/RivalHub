import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import * as schema from "@/db/schema";
import { lockMatchInTx, lockMatchForInspectionInTx } from "@/lib/matches/locking";
import { createLocalPool } from "./harness/database";
import { seedFixture } from "./harness/mizar";

// A real PostgreSQL wait graph, rather than sleep-based ordering or mocked SQL.
it.each([false, true])("locks season before match and observes archive after the barrier: %s", async archived => {
  const f = await seedFixture();
  const pool = createLocalPool({ max: 3 });
  const a = await pool.connect(); const b = await pool.connect(); const observer = await pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await a.query("SET statement_timeout = '5s'");
    await b.query("SET statement_timeout = '5s'");
    await b.query("BEGIN");
    await b.query("SELECT id FROM seasons WHERE id=$1 FOR UPDATE", [f.seasonId]);
    if (archived) await b.query("UPDATE seasons SET status='archived' WHERE id=$1", [f.seasonId]);
    const aPid = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = drizzle(a, { schema }).transaction(tx => lockMatchInTx(tx, f.matchId))
      .then(value => ({ value }), error => ({ error }));
    let blocked = false;
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const result = await observer.query("SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocked", [aPid, bPid]);
      if (result.rows[0].blocked) { blocked = true; break; }
      await delay(10);
    }
    expect(blocked).toBe(true);
    // An old match-first caller already owns this row while waiting on season.
    // This acquisition therefore closes the old cycle and reproduces 40P01.
    await b.query("SELECT id FROM matches WHERE id=$1 FOR SHARE", [f.matchId]);
    await b.query("COMMIT");
    const result = await pending as { value?: schema.Match; error?: Error };
    if (archived) expect(result.error?.message).toContain("赛季已归档");
    else expect(result.value?.id).toBe(f.matchId);
    if (archived) {
      const inspected = await drizzle(a, { schema }).transaction(tx => lockMatchForInspectionInTx(tx, f.matchId));
      expect(inspected.id).toBe(f.matchId);
    }
  } finally {
    await b.query("ROLLBACK");
    if (pending) await pending;
    a.release(); b.release(); observer.release(); await pool.end();
  }
});
