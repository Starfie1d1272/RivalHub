import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import { expect, it } from "vitest";
import { stakeBetInTx } from "@/lib/bet/service";
import { fixture, read } from "../harness/bet-fixture";

async function waitForLock(pool: Pool, name: string) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [name]);
    if (result.rowCount) return;
    await delay(10);
  }
  throw new Error("EXPECTED_LOCK_WAIT_NOT_OBSERVED");
}

// Force both orders across the gameplay boundary using real row locks.
it("serializes BET submission and gameplay start in both lock orders", async () => {
  await fixture(async f => {
    const market = (await read(f.db, f.seasonId, f.userId)).markets.find(m => m.type === "match_winner")!;
    const args = { seasonId: f.seasonId, userId: f.userId, marketId: market.id, optionId: market.options[0]!.id, amount: "1", requestId: randomUUID() };
    const holder = await f.db.$client.connect();
    let submission: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("UPDATE matches SET status = 'in_progress', gameplay_started_at = now() WHERE id = $1", [f.matchId]);
      submission = f.db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local application_name = 'bet-boundary-submit'`);
        return stakeBetInTx(tx, args);
      });
      void submission.catch(() => undefined);
      await waitForLock(f.db.$client, "bet-boundary-submit");
      await holder.query("COMMIT");
      await expect(submission).rejects.toThrow(/锁定/);
      expect((await read(f.db, f.seasonId, f.userId)).balance).toBe("1000");
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await submission?.catch(() => undefined);
    }
  });
  await fixture(async f => {
    const market = (await read(f.db, f.seasonId, f.userId)).markets.find(m => m.type === "match_winner")!;
    const args = { seasonId: f.seasonId, userId: f.userId, marketId: market.id, optionId: market.options[0]!.id, amount: "1", requestId: randomUUID() };
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let ready!: () => void;
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const submission = f.db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await stakeBetInTx(tx, args);
      ready();
      await barrier;
    });
    try {
      await Promise.race([locked, submission.then(() => { throw new Error("SUBMISSION_ENDED_BEFORE_BARRIER"); })]);
      const starter = await f.db.$client.connect();
      let start: Promise<unknown> | undefined;
      try {
        await starter.query("BEGIN");
        await starter.query("SET LOCAL lock_timeout = '2s'");
        await starter.query("SET LOCAL application_name = 'bet-boundary-start'");
        start = starter.query("UPDATE matches SET status = 'in_progress', gameplay_started_at = now() WHERE id = $1", [f.matchId]);
        void start.catch(() => undefined);
        await waitForLock(f.db.$client, "bet-boundary-start");
        release();
        await submission;
        await start;
        await starter.query("COMMIT");
      } finally {
        release();
        await starter.query("ROLLBACK");
        await start?.catch(() => undefined);
        starter.release();
      }
      expect((await read(f.db, f.seasonId, f.userId)).balance).toBe("999");
      await expect(f.db.transaction(tx => stakeBetInTx(tx, { ...args, requestId: randomUUID() }))).rejects.toThrow(/锁定/);
    } finally { release(); await submission.catch(() => undefined); }
  });
}, 30000);
