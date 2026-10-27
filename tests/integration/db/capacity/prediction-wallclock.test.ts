import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { lockPredictionProgram, savePickInTx } from "@/lib/predictions/service";
import { predictionCapacityFixture } from "./prediction-fixture";

it("uses PostgreSQL wall time when a complete prediction waits across cutoff", async () => {
  await predictionCapacityFixture(async f => {
    const [contest] = await f.db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, f.seasonId));
    const ids = contest!.entrants.map(entry => entry.teamId);
    const input = { seasonId: f.seasonId, userId: f.userId, contestId: contest!.id, pick: { perfect: ids.slice(0, 2), advance: ids.slice(2, 8), eliminated: ids.slice(8, 10) }, submitted: true, requestId: randomUUID() };
    await f.db.transaction(tx => savePickInTx(tx, input));
    await f.db.transaction(tx => savePickInTx(tx, input));
    expect(await f.db.select().from(schema.predictionPicks)).toHaveLength(1);
    let release!: () => void; let announce!: (deadline: Date) => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<Date>(resolve => { announce = resolve; });
    let after: Date | undefined;
    const cutoff = f.db.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await lockPredictionProgram(tx, f.seasonId);
      const rows = await tx.execute<{ deadline: Date }>(sql`update prediction_contests set deadline = clock_timestamp() + interval '1 second' where id = ${contest!.id} returning deadline`);
      announce(new Date(rows.rows[0]!.deadline));
      await gate;
      await tx.execute(sql`select pg_sleep(1.2)`);
      const clock = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
      after = new Date(clock.rows[0]!.now);
    });
    let pending: Promise<unknown> | undefined;
    try {
      const deadline = await Promise.race([ready, cutoff.then(() => { throw new Error("CUTOFF_ENDED_BEFORE_BARRIER"); })]);
      pending = f.db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '5s'`);
        await tx.execute(sql`set local statement_timeout = '8s'`);
        await tx.execute(sql`set local application_name = 'prediction-wallclock'`);
        return savePickInTx(tx, { ...input, userId: f.otherId, requestId: randomUUID() });
      });
      void pending.catch(() => undefined);
      let waiting = false; let before: Date | undefined; const limit = Date.now() + 900;
      while (Date.now() < limit) {
        const sample = await f.pool.query("select clock_timestamp() as now from pg_stat_activity where application_name = 'prediction-wallclock' and wait_event_type = 'Lock'");
        if (sample.rowCount) { waiting = true; before = new Date(sample.rows[0].now); break; }
        await delay(10);
      }
      expect(waiting && before!.getTime() < deadline.getTime()).toBe(true);
      release(); await cutoff;
      expect(after!.getTime()).toBeGreaterThan(deadline.getTime());
      await expect(pending).rejects.toThrow(/截止/);
      expect(await f.db.select().from(schema.predictionPicks)).toHaveLength(1);
    } finally { release(); await cutoff.catch(() => undefined); await pending?.catch(() => undefined); }
  }, 24);
}, 30000);
