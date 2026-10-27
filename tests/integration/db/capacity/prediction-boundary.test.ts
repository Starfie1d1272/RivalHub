import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { lockPredictionProgram, savePickInTx } from "@/lib/predictions/service";
import { predictionCapacityFixture } from "./prediction-fixture";

it("rejects a pick queued before the deadline closes when the cutoff commits first", async () => {
  await predictionCapacityFixture(async f => {
    const [contest] = await f.db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, f.seasonId));
    const input = { seasonId: f.seasonId, userId: f.userId, contestId: contest!.id, pick: { perfect: [], advance: [], eliminated: [] }, submitted: false, requestId: randomUUID() };
    await f.db.transaction(tx => savePickInTx(tx, input));
    await f.db.transaction(tx => savePickInTx(tx, input));
    expect(await f.db.select().from(schema.predictionPicks)).toHaveLength(1);
    let release!: () => void; let ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const cutoff = f.db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await lockPredictionProgram(tx, f.seasonId);
      await tx.update(schema.predictionContests).set({ deadline: new Date(Date.now() - 1000) }).where(eq(schema.predictionContests.id, contest!.id));
      ready(); await gate;
    });
    let pending: Promise<unknown> | undefined;
    try {
      await Promise.race([locked, cutoff.then(() => { throw new Error("CUTOFF_ENDED_BEFORE_BARRIER"); })]);
      pending = f.db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local statement_timeout = '5s'`);
        await tx.execute(sql`set local application_name = 'prediction-capacity-late'`);
        return savePickInTx(tx, { ...input, userId: f.otherId, requestId: randomUUID() });
      });
      void pending.catch(() => undefined);
      let waiting = false;
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        const sample = await f.pool.query("select 1 from pg_stat_activity where application_name = 'prediction-capacity-late' and wait_event_type = 'Lock'");
        if (sample.rowCount) { waiting = true; break; }
        await delay(10);
      }
      expect(waiting).toBe(true);
      release(); await cutoff;
      await expect(pending).rejects.toThrow(/截止/);
      expect(await f.db.select().from(schema.predictionPicks)).toHaveLength(1);
    } finally {
      release(); await cutoff.catch(() => undefined); await pending?.catch(() => undefined);
    }
  }, 24);
}, 30000);
