import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { applyResultCorrectionInTx, planResultCorrectionInTx } from "@/lib/match-corrections/service";
import { finalizeMajorSwissRoundInTransaction } from "@/lib/major/swiss-runtime";
import { balanceOf, lockPredictionProgram, openPredictionMarketInTx, reconcilePredictionProgram, stakeInTx } from "@/lib/predictions/service";
import { predictionCapacityFixture } from "./prediction-fixture";

it("reconciles a score correction before a queued late stake", async () => {
  await predictionCapacityFixture(async f => {
    const opened = await f.db.transaction(tx => openPredictionMarketInTx(tx, { seasonId: f.seasonId, actorId: "test", matchId: f.matchIds[0]!, deadline: new Date(Date.now() + 1800000) }));
    const options = await f.db.select().from(schema.predictionMarketOptions).where(eq(schema.predictionMarketOptions.marketId, opened.id)).orderBy(schema.predictionMarketOptions.position);
    const stake = { seasonId: f.seasonId, userId: f.userId, marketId: opened.id, optionId: options[0]!.id, amount: "100", requestId: randomUUID() };
    await f.db.transaction(tx => stakeInTx(tx, stake));
    await f.db.transaction(tx => stakeInTx(tx, { ...stake, userId: f.otherId, optionId: options[1]!.id, requestId: randomUUID() }));
    await f.db.update(schema.matches).set({ status: "finished", scoreA: 1, scoreB: 0, completedAt: new Date() }).where(and(eq(schema.matches.majorStageRunId, f.runId), eq(schema.matches.round, 1)));
    await f.db.transaction(tx => finalizeMajorSwissRoundInTransaction(tx, { seasonId: f.seasonId, stageRunId: f.runId, expectedRound: 1, actorId: "test" }));
    const reconcile = () => f.db.transaction(async tx => reconcilePredictionProgram(tx, await lockPredictionProgram(tx, f.seasonId)));
    await reconcile();
    const accounts = await f.db.select().from(schema.predictionAccounts).where(eq(schema.predictionAccounts.seasonId, f.seasonId));
    const account = (id: string) => accounts.find(row => row.userId === id)!;
    const balance = (id: string) => f.db.transaction(tx => balanceOf(tx, account(id).id));
    expect(await balance(f.userId)).toBe(BigInt(1100));
    expect(await balance(f.otherId)).toBe(BigInt(900));
    const correctionInput = { matchId: f.matchIds[0]!, proposal: { scoreA: 0, scoreB: 1 }, actorId: "test", confirmRecovery: true };
    const plan = await f.db.transaction(tx => planResultCorrectionInTx(tx, correctionInput));
    expect(plan.winnerChanges).toBe(true);
    let release!: () => void; let ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const correction = f.db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      expect(await applyResultCorrectionInTx(tx, correctionInput)).toMatchObject({ alreadyApplied: false, winnerChanged: true });
      await reconcilePredictionProgram(tx, await lockPredictionProgram(tx, f.seasonId));
      ready(); await gate;
    });
    let late: Promise<unknown> | undefined;
    try {
      await Promise.race([locked, correction.then(() => { throw new Error("CORRECTION_ENDED_BEFORE_BARRIER"); })]);
      late = f.db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local statement_timeout = '5s'`);
        await tx.execute(sql`set local application_name = 'prediction-capacity-correction'`);
        return stakeInTx(tx, { ...stake, requestId: randomUUID() });
      });
      void late.catch(() => undefined);
      let waiting = false; const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        const sample = await f.pool.query("select 1 from pg_stat_activity where application_name = 'prediction-capacity-correction' and wait_event_type = 'Lock'");
        if (sample.rowCount) { waiting = true; break; }
        await delay(10);
      }
      expect(waiting).toBe(true);
      release(); await correction;
      await expect(late).rejects.toThrow(/关闭|截止|锁定/);
      expect(await balance(f.userId)).toBe(BigInt(900));
      // Formal recovery rolls the Swiss acceptance cursor back; settlement is
      // pending until the corrected round is finalized again.
      expect(await balance(f.otherId)).toBe(BigInt(900));
      await f.db.transaction(tx => finalizeMajorSwissRoundInTransaction(tx, { seasonId: f.seasonId, stageRunId: f.runId, expectedRound: 1, actorId: "test" }));
      await reconcile();
      expect(await balance(f.otherId)).toBe(BigInt(1100));
      expect(await f.db.transaction(tx => applyResultCorrectionInTx(tx, correctionInput))).toMatchObject({ alreadyApplied: true });
      expect((await f.db.select().from(schema.auditLogs)).filter(row => row.action === "match.result.corrected")).toHaveLength(1);
      await reconcile();
      expect(await balance(f.userId)).toBe(BigInt(900));
      expect(await balance(f.otherId)).toBe(BigInt(1100));
    } finally { release(); await correction.catch(() => undefined); await late?.catch(() => undefined); }
  }, 32);
}, 30000);

it("holds a known stake replay before formal correction and recovers settlement", async () => {
  await predictionCapacityFixture(async f => {
    const opened = await f.db.transaction(tx => openPredictionMarketInTx(tx, { seasonId: f.seasonId, actorId: "test", matchId: f.matchIds[0]!, deadline: new Date(Date.now() + 1800000) }));
    const options = await f.db.select().from(schema.predictionMarketOptions).where(eq(schema.predictionMarketOptions.marketId, opened.id)).orderBy(schema.predictionMarketOptions.position);
    const stake = { seasonId: f.seasonId, userId: f.userId, marketId: opened.id, optionId: options[0]!.id, amount: "100", requestId: randomUUID() };
    await f.db.transaction(tx => stakeInTx(tx, stake));
    await f.db.transaction(tx => stakeInTx(tx, { ...stake, userId: f.otherId, optionId: options[1]!.id, requestId: randomUUID() }));
    await f.db.update(schema.matches).set({ status: "finished", scoreA: 1, scoreB: 0, completedAt: new Date() }).where(and(eq(schema.matches.majorStageRunId, f.runId), eq(schema.matches.round, 1)));
    await f.db.transaction(tx => finalizeMajorSwissRoundInTransaction(tx, { seasonId: f.seasonId, stageRunId: f.runId, expectedRound: 1, actorId: "test" }));
    const reconcile = () => f.db.transaction(async tx => reconcilePredictionProgram(tx, await lockPredictionProgram(tx, f.seasonId)));
    await reconcile();
    const correctionInput = { matchId: f.matchIds[0]!, proposal: { scoreA: 0, scoreB: 1 }, actorId: "test", confirmRecovery: true };
    expect((await f.db.transaction(tx => planResultCorrectionInTx(tx, correctionInput))).winnerChanges).toBe(true);
    let release!: () => void; let ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const replay = f.db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await stakeInTx(tx, stake);
      ready(); await gate;
    });
    let correction: Promise<unknown> | undefined;
    try {
      await Promise.race([locked, replay.then(() => { throw new Error("REPLAY_ENDED_BEFORE_BARRIER"); })]);
      correction = f.db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local application_name = 'prediction-correction-reverse'`);
        return applyResultCorrectionInTx(tx, correctionInput);
      });
      void correction.catch(() => undefined);
      let waiting = false; const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        if ((await f.pool.query("select 1 from pg_stat_activity where application_name = 'prediction-correction-reverse' and wait_event_type = 'Lock'")).rowCount) { waiting = true; break; }
        await delay(10);
      }
      expect(waiting).toBe(true);
      release(); await replay;
      expect(await correction).toMatchObject({ alreadyApplied: false, winnerChanged: true });
      await reconcile();
      await f.db.transaction(tx => finalizeMajorSwissRoundInTransaction(tx, { seasonId: f.seasonId, stageRunId: f.runId, expectedRound: 1, actorId: "test" }));
      await reconcile(); await reconcile();
      const accounts = await f.db.select().from(schema.predictionAccounts).where(eq(schema.predictionAccounts.seasonId, f.seasonId));
      expect(await f.db.transaction(tx => balanceOf(tx, accounts.find(a => a.userId === f.userId)!.id))).toBe(BigInt(900));
      expect(await f.db.transaction(tx => balanceOf(tx, accounts.find(a => a.userId === f.otherId)!.id))).toBe(BigInt(1100));
      expect(await f.db.select().from(schema.predictionStakes)).toHaveLength(2);
      expect((await f.db.select().from(schema.auditLogs)).filter(row => row.action === "match.result.corrected")).toHaveLength(1);
    } finally { release(); await replay.catch(() => undefined); await correction?.catch(() => undefined); }
  }, 32);
}, 30000);
