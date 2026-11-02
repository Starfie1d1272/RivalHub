import { initializePreviewPickEm } from "../../../scripts/db/preview/predictions";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { recordLegacyRetirementPreflight } from "@/lib/predictions/retirement-preflight";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { describe, it, expect } from "vitest";
import * as schema from "@/db/schema";
import { createMajorDefaultCapabilities, createMajor24Capabilities } from "@/lib/competition/templates";
import { makeMajorRunSnapshotV4, resolveMajorStagePlan } from "@/lib/major/run-snapshot";
import { finalizeMajorSwissRoundInTransaction } from "@/lib/major/swiss-runtime";
import { transitionMajorSwissStageInTransaction } from "@/lib/major/stage-transition";
import { DEFAULT_RULES } from "@/lib/predictions/rules";
import { runPredictionReconciliationJob } from "@/lib/predictions/reconciliation";
import { loadBaseline } from "@/lib/predictions/baseline";
import { projectPredictionStages } from "@/lib/predictions/stage-projection";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { simulateMajor } from "@/lib/predictions/simulator";
import {
  syncAutomaticPickEmInTx,
  joinPredictionsInTx,
  savePickInTx,
  lockPredictionProgram,
  reconcilePredictionProgram,
  balanceOf,
} from "@/lib/predictions/service";
import { predictionBoard } from "@/lib/predictions/data";
import { buildUserMergePreflight } from "@/lib/identity/merge";
import type { Choices } from "@/lib/predictions/types";
import { localDatabaseUrl } from "./harness/database";
import {
  migrationFiles,
  replayMigration,
  withScratchDatabase,
} from "./harness/migration-replay";

type Fixture = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  pool: Pool;
  seasonId: string;
  userId: string;
  otherId: string;
  runId: string;
  matchIds: string[];
};
async function fixture(work: (f: Fixture) => Promise<void>, capacity: 24 | 32 = 32, initializePredictions = true, legacyHistory = false) {
  await withScratchDatabase("prediction_test", async (client) => {
    for (const file of migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name) && !(legacyHistory && name.startsWith("0109_"))))
      await replayMigration(client, file);
    await client.query(readFileSync("drizzle/migrations/0001_amused_kang.sql", "utf8"));
    const url = new URL(localDatabaseUrl());
    url.pathname = `/${(await client.query<{ name: string }>("select current_database() as name")).rows[0]!.name}`;
    const pool = new Pool({
      connectionString: url.toString(),
      ssl: false,
      max: 6,
    });
    const db = drizzle(pool, { schema });
    try {
      const userId = randomUUID(),
        otherId = randomUUID(),
        seasonId = randomUUID();
      await db.insert(schema.users).values(
        [userId, otherId].map((id) => ({
          id,
          email: `${id}@example.test`,
          emailVerifiedAt: new Date(),
          emailVerificationSource: "admin_migration" as const,
          displayName: id === userId ? "观众甲" : "观众乙",
        })),
      );
      const cap = capacity === 24 ? createMajor24Capabilities() : createMajorDefaultCapabilities();
      await db.insert(schema.seasons).values({
        ...cap,
        id: seasonId,
        slug: `prediction-${seasonId}`,
        name: "Prediction Test",
        kind: "Major",
        competitionTemplate: "major",
        status: "playing",
      });
      const entrants: { id: string; teamId: string; seed: number }[] = [];
      for (let seed = 1; seed <= capacity; seed++) {
        const teamId = randomUUID(),
          revisionId = randomUUID();
        await db.transaction(async (tx) => {
          await tx.insert(schema.competitionEntries).values({
            id: teamId,
            competitionId: seasonId,
            source: "event_native",
            name: `T${seed}`,
            representativeUserId: userId,
            currentRosterRevisionId: revisionId,
            approvedRosterRevisionId: revisionId,
            registrationStatus: "approved",
          });
          await tx.insert(schema.competitionEntryRepresentativeChanges).values({
            entryId: teamId,
            toUserId: userId,
            changedByActorId: "test",
          });
          await tx.insert(schema.competitionEntryRosterRevisions).values({
            id: revisionId,
            entryId: teamId,
            revisionNumber: 1,
            status: "approved",
            createdBy: "test",
            approvedAt: new Date(),
          });
        });
        const [entrant] = await db
          .insert(schema.majorTournamentEntrants)
          .values({ seasonId, competitionEntryId: teamId })
          .returning();
        await db
          .insert(schema.majorTournamentSeeds)
          .values({ seasonId, tournamentEntrantId: entrant!.id, seed });
        entrants.push({ id: entrant!.id, teamId, seed });
      }
      await db.insert(schema.majorPrestartStates).values({
        seasonId,
        seedsConfirmedAt: new Date(),
        seedsConfirmedBy: "test",
        seedsLockedAt: new Date(),
        seedsLockedBy: "test",
        entrantsLockedAt: new Date(),
        entrantsLockedBy: "test",
      });
      const snapshot = makeMajorRunSnapshotV4({
        stagePlan: cap.stagePlan.map((s) => ({
          ...s,
          matchFormat: s.matchFormat!,
          finalFormat: s.finalFormat ?? null,
        })),
        rosterRules: { minTeamSize: 5, maxTeamSize: 9, starterCount: 5 },
        affiliationRules: cap.affiliationRules,
        competitiveProfile: null,
        frozenCompetitiveFacts: [],
      });
      const [run] = await db
        .insert(schema.majorStageRuns)
        .values({
          seasonId,
          stageKey: "stage1",
          ruleSnapshot: snapshot,
          startedBy: "test",
        })
        .returning();
      const runId = run!.id;
      await db.insert(schema.majorStageEntrants).values(
        entrants
          .filter((e) => e.seed > capacity - 16)
          .map((e) => ({
            seasonId,
            stageRunId: runId,
            tournamentEntrantId: e.id,
            stageSeed: e.seed - (capacity - 16),
          })),
      );
      const base = await loadBaseline(db, seasonId);
      const round = simulateMajor(base, {})[0]!.matches;
      const created = await db
        .insert(schema.matches)
        .values(
          round.map((m) => ({
            seasonId,
            majorStageRunId: runId,
            ownership: "major_stage" as const,
            managedKey: m.key,
            stage: "stage1",
            round: 1,
            entryAId: m.a,
            entryBId: m.b,
            format: m.format as "bo1" | "bo3",
            scheduledAt: new Date(Date.now() + 3600000),
          })),
        )
        .returning({ id: schema.matches.id });
      if (initializePredictions) {
      await db.transaction((tx) =>
        syncAutomaticPickEmInTx(tx, seasonId),
      );
      await Promise.all(
        [userId, otherId].map((id) =>
          db.transaction((tx) =>
            joinPredictionsInTx(tx, { seasonId, userId: id }),
          ),
        ),
      );
      }
      await work({
        db,
        pool,
        seasonId,
        userId,
        otherId,
        runId,
        matchIds: created.map((m) => m.id),
      });
    } finally {
      await pool.end();
    }
  });
}
async function reconcile(f: Fixture) {
  return f.db.transaction(async (tx) =>
    reconcilePredictionProgram(tx, await lockPredictionProgram(tx, f.seasonId)),
  );
}
async function account(f: Fixture, userId = f.userId) {
  const [a] = await f.db
    .select()
    .from(schema.predictionAccounts)
    .where(
      and(
        eq(schema.predictionAccounts.userId, userId),
        eq(schema.predictionAccounts.seasonId, f.seasonId),
      ),
    );
  return a!;
}
async function balance(f: Fixture, userId = f.userId) {
  return f.db.transaction(async (tx) =>
    balanceOf(tx, (await account(f, userId)).id),
  );
}
function fill(base: Awaited<ReturnType<typeof loadBaseline>>, key = "stage1") {
  const choices: Choices = {};
  for (let i = 0; i < 8; i++) {
    const stage = simulateMajor(base, choices).find((stage) => stage.key === key)!;
    if (stage.complete) return { stage, choices };
    for (const m of stage.matches.filter((m) => !m.winner))
      choices[`${key}/${m.key}`] = { a: m.a, b: m.b, winner: m.a };
  }
  throw Error("incomplete");
}


it("keeps baseline, revision, simulation and Pick’Em frozen across v3/v4 projected runs", async () =>
  fixture(async (f) => {
    const { db, seasonId, runId, userId } = f;
    const [initialRun] = await db.select().from(schema.majorStageRuns).where(eq(schema.majorStageRuns.id, runId));
    const snapshot = initialRun!.ruleSnapshot as ReturnType<typeof makeMajorRunSnapshotV4>;
    const large = { ...snapshot, affiliationRules: ["FROZEN_UNUSED_MARKER".repeat(5000)],
      frozenCompetitiveFacts: ["FROZEN_UNUSED_MARKER".repeat(5000)], competitiveProfile: { frozen: "FROZEN_UNUSED_MARKER".repeat(5000) } };
    await db.update(schema.majorStageRuns).set({ ruleSnapshot: large }).where(eq(schema.majorStageRuns.id, runId));
    const queries: Array<{ query: string; params: unknown[] }> = [];
    const observed = drizzle(f.pool, { schema, logger: { logQuery: (query, params) => queries.push({ query, params }) } });
    const before = await loadBaseline(observed, seasonId);
    const fullRows = await db.select().from(schema.majorStageRuns).where(eq(schema.majorStageRuns.seasonId, seasonId));
    const legacyStages = projectPredictionStages(resolveMajorStagePlan([], fullRows));
    expect(before.stages).toEqual(legacyStages);
    const legacyRevision = createHash("sha256").update(JSON.stringify({ version: before.version, stages: legacyStages,
      teams: [...before.teams].sort((a, b) => a.tournamentSeed - b.tournamentSeed),
      runs: [...before.runs].sort((a, b) => a.key.localeCompare(b.key)),
      matches: [...before.matches].sort((a, b) => a.id.localeCompare(b.id)) })).digest("hex");
    expect(before.revision).toBe(legacyRevision);
    const runQuery = queries.find(({ query }) => query.includes('from "major_stage_runs"'))!;
    expect(runQuery.query).toContain("jsonb_build_object");
    const result = await f.pool.query(runQuery.query, runQuery.params);
    expect(JSON.stringify(result.rows)).not.toContain("FROZEN_UNUSED_MARKER");
    expect(Buffer.byteLength(JSON.stringify(result.rows))).toBeLessThan(Buffer.byteLength(JSON.stringify(fullRows)));
    const boardBefore = await db.transaction(tx => predictionBoard(tx, seasonId, userId));
    const entrants = await db.select({ entrantId: schema.majorTournamentEntrants.id,
      competitionEntryId: schema.majorTournamentEntrants.competitionEntryId, tournamentSeed: schema.majorTournamentSeeds.seed })
      .from(schema.majorTournamentEntrants).innerJoin(schema.majorTournamentSeeds, eq(schema.majorTournamentSeeds.tournamentEntrantId, schema.majorTournamentEntrants.id))
      .where(eq(schema.majorTournamentEntrants.seasonId, seasonId));
    const v3 = { ...large, version: 3, stage: large.stagePlan.find(stage => stage.key === "stage1"), tournamentEntrants: entrants };
    await db.update(schema.majorStageRuns).set({ ruleSnapshot: v3 }).where(eq(schema.majorStageRuns.id, runId));
    const legacy = await loadBaseline(db, seasonId);
    expect({ ...legacy, capturedAt: before.capturedAt }).toEqual(before);
    expect(legacy.revision).toBe(before.revision);
    expect(simulateMajor(legacy, {})).toEqual(simulateMajor(before, {}));
    expect(fill(legacy).stage.pick).toEqual(fill(before).stage.pick);
    const boardAfter = await db.transaction(tx => predictionBoard(tx, seasonId, userId));
    expect(boardAfter.contests).toEqual(boardBefore.contests);
    expect(boardAfter.achievement).toEqual(boardBefore.achievement);
    await db.update(schema.seasons).set({ stagePlan: [] }).where(eq(schema.seasons.id, seasonId));
    expect((await loadBaseline(db, seasonId)).revision).toBe(before.revision);

    // A later run's frozen plan wins regardless of row order, while every run
    // must still be validated rather than merely reading the last one.
    const laterPlan = large.stagePlan.map((stage, index) => index === 0 ? { ...stage, name: "Later frozen plan" } : stage);
    await db.insert(schema.majorStageRuns).values({ seasonId, stageKey: "stage2", ruleSnapshot: { ...large, stagePlan: laterPlan }, startedBy: "test" });
    const multiple = await loadBaseline(db, seasonId);
    const fullRuns = await db.select().from(schema.majorStageRuns).where(eq(schema.majorStageRuns.seasonId, seasonId));
    expect(multiple.stages).toEqual(projectPredictionStages(resolveMajorStagePlan([], fullRuns.reverse())));
    expect(multiple.stages[0]!.name).toBe("Later frozen plan");
    await db.update(schema.majorStageRuns).set({ ruleSnapshot: { ...v3, affiliationRules: null } }).where(eq(schema.majorStageRuns.id, runId));
    await expect(loadBaseline(db, seasonId)).rejects.toThrow("StageRun snapshot 无效");

    await db.delete(schema.matches).where(eq(schema.matches.seasonId, seasonId));
    await db.delete(schema.majorStageEntrants).where(eq(schema.majorStageEntrants.seasonId, seasonId));
    await db.delete(schema.majorStageRuns).where(eq(schema.majorStageRuns.seasonId, seasonId));
    await db.update(schema.seasons).set({ stagePlan: createMajorDefaultCapabilities().stagePlan }).where(eq(schema.seasons.id, seasonId));
    const [season] = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId));
    const noRuns = await loadBaseline(db, seasonId);
    expect(noRuns.runs).toEqual([]);
    expect(noRuns.stages).toEqual(projectPredictionStages(getStandardMajorDefinition(season!).capabilities.stagePlan));
  }));

describe("spectator prediction PostgreSQL contracts", () => {
  it("submits against the frozen 24-team profile", async () =>
    fixture(async (f) => {
      const { db, seasonId, userId } = f;
      // A later edit to the live preset must not reinterpret an already started event.
      await db.update(schema.seasons).set({ stagePlan: createMajorDefaultCapabilities().stagePlan }).where(eq(schema.seasons.id, seasonId));
      const base = await loadBaseline(db, seasonId);
      expect(base.teams).toHaveLength(24);
      expect(base.stages).toHaveLength(3);
      const { id } = (await db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, seasonId)))[0]!;
      await db.transaction((tx) => savePickInTx(tx, {
        seasonId, userId, contestId: id, pick: fill(base).stage.pick!, submitted: true, requestId: randomUUID(),
      }));
      await db.update(schema.matches).set({ status: "finished", scoreA: 2, scoreB: 0, completedAt: new Date() })
        .where(and(eq(schema.matches.majorStageRunId, f.runId), eq(schema.matches.round, 1)));
      await db.transaction((tx) => finalizeMajorSwissRoundInTransaction(tx, {
        seasonId, stageRunId: f.runId, expectedRound: 1, actorId: "test",
      }));
      await reconcile(f);
      const board = await db.transaction((tx) => predictionBoard(tx, seasonId, userId));
      expect(board.rules).toMatchObject({ silver: 2, gold: 5, diamond: 8 });
      expect(board.contests[0]!.submitted).toBeTruthy();
      expect(board.contests[0]!.locked).toBe(true);
    }, 24));

  it("reads scoped spectator projections without taking reconciliation locks or writing due work", async () =>
    fixture(async (f) => {
      const { db, seasonId, userId, otherId } = f;
      for (const actor of [userId, otherId]) await db.transaction((tx) => joinPredictionsInTx(tx, { seasonId, userId: actor }));
      // History is constructed on the pre-retirement schema: 0109 deliberately refuses existing markets.
      const [match] = await db.select().from(schema.matches).where(eq(schema.matches.id, f.matchIds[0]!));
      const [pool] = await db.insert(schema.predictionMarkets).values({
        seasonId, matchId: match!.id, resolver: "match_winner", title: "比赛胜者", stageKey: match!.stage!,
        subject: { stageRunId: f.runId, entryIds: [match!.entryAId!, match!.entryBId!] }, deadline: new Date(Date.now() + 1800000),
      }).returning();
      const options = await db.insert(schema.predictionMarketOptions).values([match!.entryAId!, match!.entryBId!].map((entryId, position) => ({ marketId: pool!.id, key: entryId, entryId, label: `队伍 ${position}`, position }))).returning();
      for (const [index, actor] of [userId, otherId].entries()) {
        const owner = await account(f, actor);
        const [stake] = await db.insert(schema.predictionStakes).values({ seasonId, marketId: pool!.id, accountId: owner.id, optionId: options[index]!.id, amount: BigInt(100), requestId: randomUUID() }).returning();
        await db.insert(schema.predictionLedger).values({ seasonId, accountId: owner.id, amount: BigInt(-100), kind: "stake", source: `stake/${stake!.id}` });
      }
      const [otherMatch] = await db.select().from(schema.matches).where(eq(schema.matches.id, f.matchIds[1]!));
      const [otherPool] = await db.insert(schema.predictionMarkets).values({
        seasonId, matchId: otherMatch!.id, resolver: "match_winner", title: "比赛胜者", stageKey: otherMatch!.stage!,
        subject: { stageRunId: f.runId, entryIds: [otherMatch!.entryAId!, otherMatch!.entryBId!] }, deadline: new Date(Date.now() + 1800000),
      }).returning();
      const [otherOption] = await db.insert(schema.predictionMarketOptions).values({ marketId: otherPool!.id, key: otherMatch!.entryAId!, entryId: otherMatch!.entryAId!, label: "队伍", position: 0 }).returning();
      await expect(db.insert(schema.predictionStakes).values({
        seasonId, marketId: pool!.id, accountId: (await account(f)).id, optionId: otherOption!.id, amount: BigInt(10), requestId: randomUUID(),
      })).rejects.toThrow();
      await expect(db.update(schema.predictionMarketOptions).set({ label: "changed" }).where(eq(schema.predictionMarketOptions.id, options[0]!.id))).rejects.toThrow();
      await db.update(schema.matches).set({ scheduledAt: new Date(Date.now() + 60_000) }).where(eq(schema.matches.id, match!.id));
      // Two historical refunds with a reversal reproduce a settled correction without calling the retired writer.
      await db.update(schema.matches).set({ status: "cancelled" }).where(eq(schema.matches.id, match!.id));
      const finalRevision = JSON.stringify({ matchId: match!.id, voided: true });
      const revisions = ["old accepted fact", finalRevision];
      const batches = [];
      for (const revision of revisions) {
        const [batch] = await db.insert(schema.predictionSettlements).values({
          marketId: pool!.id, state: "refunded", winningOptionIds: [], factRevision: revision,
          fingerprint: JSON.stringify({ state: "refunded", winningOptionIds: [], factRevision: revision }),
        }).returning();
        batches.push(batch!);
        for (const actor of [userId, otherId]) {
          const owner = await account(f, actor);
          await db.insert(schema.predictionLedger).values({ seasonId, accountId: owner.id, amount: BigInt(100), profit: BigInt(0), kind: "settlement", source: `settlement/${batch!.id}` });
        }
      }
      const oldPayouts = await db.select().from(schema.predictionLedger).where(eq(schema.predictionLedger.source, `settlement/${batches[0]!.id}`));
      for (const old of oldPayouts) await db.insert(schema.predictionLedger).values({ seasonId, accountId: old.accountId, amount: -old.amount, profit: -old.profit, kind: "reversal", source: `reversal/${batches[1]!.id}/${old.id}` });
      const [lockedBeforeRead] = await db.select().from(schema.predictionMarkets).where(eq(schema.predictionMarkets.id, pool!.id));
      const locker = await f.pool.connect();
      try {
        await locker.query("BEGIN");
        await locker.query("select season_id from prediction_programs where season_id = $1 for update", [seasonId]);
        await locker.query("select season_id from prediction_jobs where season_id = $1 for update", [seasonId]);
        const read = (view: "sim" | "points" | "record" | "all", viewerId: string | null = userId) => db.transaction(async (tx) => {
          await tx.execute(sql`set local statement_timeout = '2000ms'`);
          return predictionBoard(tx, seasonId, viewerId, view);
        }, { accessMode: "read only", isolationLevel: "repeatable read" });
        const sim = await read("sim");
        expect(sim.markets).toEqual([]);
        expect(sim.ledger).toEqual([]);
        expect(sim.pickLeaderboard).toEqual([]);
        expect(sim.achievement?.challenges).toBe(0);
        expect(sim.achievement?.progress[0]?.tasks).toHaveLength(2);
        const anonymous = await read("sim", null);
        expect(anonymous).toMatchObject({ joined: false, achievement: null, markets: [], ledger: [], pickLeaderboard: [] });
        expect(anonymous.contests.every(contest => contest.draft === null && contest.submitted === null)).toBe(true);
        const outsider = await read("sim", randomUUID());
        expect(outsider).toMatchObject({ joined: false, achievement: null, markets: [], ledger: [] });
        const points = await read("points");
        const historyMarket = points.markets.find(market => market.id === pool!.id)!;
        expect(historyMarket).toMatchObject({ participants: 2, myStake: "100", myOptionId: options[0]!.id, locked: true });
        expect(new Date(historyMarket.deadline).getTime()).toBeLessThan(Date.now());
        expect(historyMarket.options.map((option) => option.pool)).toEqual(["100", "100"]);
        expect(points.ledger).toEqual([]);
        const record = await read("record");
        expect(record.markets).toEqual([]);
        expect((await read("all")).ledger.some(row => row.kind === "stake" && row.amount === "-100")).toBe(true);
        const [unchanged] = await db.select().from(schema.predictionMarkets).where(eq(schema.predictionMarkets.id, pool!.id));
        expect(unchanged!.lockedAt).toEqual(lockedBeforeRead!.lockedAt);
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
      }
      const before = await db.transaction(tx => predictionBoard(tx, seasonId, userId));
      const migration = readFileSync("drizzle/v2-migrations/0109_retire_legacy_prediction_finance.sql", "utf8");
      const unverified = await f.pool.connect();
      try {
        await unverified.query("BEGIN");
        await expect(unverified.query(migration)).rejects.toThrow(/matching verified retirement snapshot/);
        await unverified.query("ROLLBACK");
      } finally { unverified.release(); }
      await db.transaction(tx => recordLegacyRetirementPreflight(tx, { actorId: "fixture-operator", reason: "synthetic retirement review" }));
      const [originalRun] = await db.select().from(schema.majorStageRuns).where(eq(schema.majorStageRuns.id, f.runId));
      await db.update(schema.majorStageRuns).set({ startedBy: `${originalRun!.startedBy}-changed` }).where(eq(schema.majorStageRuns.id, f.runId));
      const stale = await f.pool.connect();
      try {
        await stale.query("BEGIN");
        await expect(stale.query(migration)).rejects.toThrow(/matching verified retirement snapshot/);
        await stale.query("ROLLBACK");
      } finally { stale.release(); }
      await db.update(schema.majorStageRuns).set({ startedBy: originalRun!.startedBy }).where(eq(schema.majorStageRuns.id, f.runId));
      const migrator = await f.pool.connect();
      try { await migrator.query("BEGIN"); await migrator.query(migration); await migrator.query("COMMIT"); }
      catch (error) { await migrator.query("ROLLBACK"); throw error; }
      finally { migrator.release(); }
      const repeated = await f.pool.connect();
      try { await repeated.query("BEGIN"); await repeated.query(migration); await repeated.query("COMMIT"); }
      catch (error) { await repeated.query("ROLLBACK"); throw error; }
      finally { repeated.release(); }
      const after = await db.transaction(tx => predictionBoard(tx, seasonId, userId));
      expect(after.markets).toEqual(before.markets);
      expect(after.ledger).toEqual(before.ledger);
      await expect(f.pool.query("INSERT INTO prediction_stakes (season_id, market_id, account_id, option_id, amount, request_id) VALUES ($1,$2,$3,$4,1,$5)", [seasonId, pool!.id, (await account(f)).id, options[0]!.id, randomUUID()])).rejects.toThrow(/retired/);
      await expect(f.pool.query("UPDATE prediction_markets SET title='changed' WHERE id=$1", [pool!.id])).rejects.toThrow(/retired/);
      await expect(f.pool.query("INSERT INTO prediction_settlements (market_id, fingerprint, state, winning_option_ids, fact_revision) VALUES ($1, $2, $3, $4, $5)", [pool!.id, "fixture", "pending", "[]", "fixture"])).rejects.toThrow(/retired/);
      await expect(f.pool.query("UPDATE prediction_ledger SET amount=0 WHERE id=$1", [oldPayouts[0]!.id])).rejects.toThrow(/retired|append-only/);
      await expect(f.pool.query("INSERT INTO prediction_ledger (season_id, account_id, amount, kind, source) VALUES ($1,$2,-1,'stake',$3)", [seasonId, (await account(f)).id, `stake/${randomUUID()}`])).rejects.toThrow(/retired/);
      const owner = await account(f);
      const [participation] = await db.insert(schema.predictionLedger).values({ seasonId, accountId: owner.id, amount: BigInt(7), kind: "participation", source: `participation/${randomUUID()}` }).returning();
      await db.insert(schema.predictionLedger).values({ seasonId, accountId: owner.id, amount: BigInt(-7), kind: "reversal", source: `void/${participation!.id}` });
    }, 32, true, true));

  it("shares due-work detection across primary dispatch and deadline reconciliation without idle batch starvation", async () =>
    fixture(async (f) => {
      const { db, seasonId } = f;
      await reconcile(f);
      const due = async () => (await f.pool.query<{ due: boolean }>("select public.scheduler_job_is_due('reconcile-predictions') as due")).rows[0]!.due;
      expect(await due()).toBe(false);
      expect((await f.pool.query("select public.dispatch_rivalhub_scheduler_job('reconcile-predictions') as request_id")).rows[0]!.request_id).toBeNull();
      expect((await f.pool.query("select has_function_privilege('anon', 'public.prediction_reconciliation_is_due(uuid)', 'EXECUTE') as allowed")).rows[0]!.allowed).toBe(false);
      for (let i = 0; i < 11; i++) {
        const idleId = randomUUID();
        await db.insert(schema.seasons).values({ ...createMajorDefaultCapabilities(), id: idleId, slug: `idle-${idleId}`, name: "Idle", kind: "Major", competitionTemplate: "major", status: "playing" });
        await db.insert(schema.predictionPrograms).values({ seasonId: idleId, rules: DEFAULT_RULES });
        await db.insert(schema.predictionJobs).values({ seasonId: idleId, dirty: false, updatedAt: new Date(0) });
      }
      await db.update(schema.predictionContests).set({ deadline: new Date(Date.now() - 1000) }).where(eq(schema.predictionContests.seasonId, seasonId));
      await db.update(schema.predictionJobs).set({ dirty: false }).where(eq(schema.predictionJobs.seasonId, seasonId));
      expect(await due()).toBe(true);
      expect((await runPredictionReconciliationJob(db)).result.completed).toBe(1);
      expect((await db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, seasonId)))[0]!.lockedAt).not.toBeNull();
      expect(await due()).toBe(false);
      expect((await runPredictionReconciliationJob(db)).result.completed).toBe(0);
      await db.update(schema.matches).set({ status: "in_progress" }).where(eq(schema.matches.id, f.matchIds[0]!));
      expect(await due()).toBe(true);
    }));

  it("rebuilds idempotent Preview stage windows from official entrants without viewer accounts or picks", async () =>
    fixture(async ({ db, seasonId }) => {
      await initializePreviewPickEm(db);
      await initializePreviewPickEm(db);
      expect(await db.select().from(schema.predictionPrograms).where(eq(schema.predictionPrograms.seasonId, seasonId))).toHaveLength(1);
      const windows = await db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, seasonId));
      expect(windows).toHaveLength(1);
      expect(windows[0]!.stageKey).toBe("stage1");
      expect(windows[0]!.entrants).toHaveLength(16);
      expect(await db.select().from(schema.predictionAccounts)).toHaveLength(0);
      expect(await db.select().from(schema.predictionPicks)).toHaveLength(0);
      expect(await db.select().from(schema.predictionLedger)).toHaveLength(0);
    }, 32, false));

  it("joins atomically on first pick save, credits once across concurrent retries and rolls back rejected first saves", async () =>
    fixture(async ({ db, seasonId }) => {
      const viewer = randomUUID(), rejected = randomUUID();
      await db.insert(schema.users).values([viewer, rejected].map((id) => ({
        id, email: `${id}@example.test`, displayName: "新观众",
        emailVerifiedAt: new Date(), emailVerificationSource: "admin_migration" as const,
      })));
      const [contest] = await db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, seasonId));
      const input = { seasonId, userId: viewer, contestId: contest!.id,
        pick: { perfect: [], advance: [], eliminated: [] }, submitted: false, requestId: randomUUID() };
      const receipts = await Promise.all([0, 1].map(() => db.transaction((tx) => savePickInTx(tx, input))));
      expect(receipts[0]).toEqual(receipts[1]);
      const viewerAccounts = await db.select().from(schema.predictionAccounts).where(and(eq(schema.predictionAccounts.seasonId, seasonId), eq(schema.predictionAccounts.userId, viewer)));
      expect(viewerAccounts).toHaveLength(1);
      const accountId = viewerAccounts[0]!.id;
      const credits = await db.select().from(schema.predictionLedger).where(eq(schema.predictionLedger.accountId, accountId));
      expect(credits.filter((row) => row.kind === "initial")).toHaveLength(1);
      expect(credits.find((row) => row.kind === "initial")!.amount).toBe(BigInt(DEFAULT_RULES.initialPoints));
      const saved = await db.select().from(schema.predictionPicks).where(eq(schema.predictionPicks.accountId, accountId));
      expect(saved).toHaveLength(1);
      expect(saved[0]!.submitted).toBe(false);
      await expect(db.transaction((tx) => savePickInTx(tx, { ...input, userId: rejected, submitted: true, requestId: randomUUID() }))).rejects.toThrow();
      expect(await db.select().from(schema.predictionAccounts).where(eq(schema.predictionAccounts.userId, rejected))).toHaveLength(0);
      await db.update(schema.matches).set({ status: "in_progress" }).where(eq(schema.matches.seasonId, seasonId));
      await expect(db.transaction((tx) => savePickInTx(tx, { ...input, userId: rejected, requestId: randomUUID() }))).rejects.toThrow("截止");
      expect(await db.select().from(schema.predictionAccounts).where(eq(schema.predictionAccounts.userId, rejected))).toHaveLength(0);
    }));

  it("keeps versioned submissions separate, blocks late requests, permanently locks on early start and protects identity/history", async () =>
    fixture(async (f) => {
      const { db, seasonId, userId } = f;
      const { id } = (await db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, seasonId)))[0]!;
      const base = await loadBaseline(db, seasonId);
      const complete = fill(base);
      const pick = complete.stage.pick!;
      const requestId = randomUUID();
      const saved = await db.transaction((tx) =>
        savePickInTx(tx, {
          seasonId,
          userId,
          contestId: id,
          pick,
          submitted: true,
          requestId,
        }),
      );
      await db.transaction((tx) =>
        savePickInTx(tx, {
          seasonId,
          userId,
          contestId: id,
          pick: { perfect: [], advance: [], eliminated: [] },
          submitted: false,
          requestId: randomUUID(),
        }),
      );
      const board = await db.transaction((tx) =>
        predictionBoard(tx, seasonId, userId),
      );
      expect(board.contests[0]!.submitted?.version).toBe(saved.version);
      expect(board.contests[0]!.draft).not.toEqual(pick);
      expect(board.contests[0]!.locked).toBe(false);
      expect(board.contests[0]!.deadlineTentative).toBe(false);
      await db.update(schema.matches).set({ scheduledAt: null }).where(eq(schema.matches.id, f.matchIds[1]!));
      const tentative = await db.transaction((tx) => predictionBoard(tx, seasonId, userId));
      expect(tentative.contests[0]!.deadlineTentative).toBe(true);
      expect(tentative.contests[0]!.deadline).toBe(board.contests[0]!.deadline);
      expect(board.achievement?.challenges).toBe(1);
      expect(board.achievement?.coin).toBe("青铜");
      expect(board.achievement?.progress[0]?.tasks[0]?.state).toBe("complete");
      expect(
        (await loadBaseline(db, seasonId)).matches.every((m) => !m.winner),
      ).toBe(true);
      await db
        .update(schema.matches)
        .set({ status: "in_progress" })
        .where(eq(schema.matches.id, f.matchIds[0]!));
      await db
        .update(schema.matches)
        .set({ status: "scheduled" })
        .where(eq(schema.matches.id, f.matchIds[0]!));
      await expect(
        db.transaction((tx) =>
          savePickInTx(tx, {
            seasonId,
            userId,
            contestId: id,
            pick,
            submitted: true,
            requestId: randomUUID(),
          }),
        ),
      ).rejects.toThrow("截止");
      const replay = await db.transaction((tx) =>
        savePickInTx(tx, {
          seasonId,
          userId,
          contestId: id,
          pick,
          submitted: true,
          requestId,
        }),
      );
      expect(replay).toEqual(saved);
      await expect(
        db
          .update(schema.predictionPicks)
          .set({ pick: { perfect: [], advance: [], eliminated: [] } })
          .where(eq(schema.predictionPicks.contestId, id)),
      ).rejects.toThrow();
      await expect(
        db
          .update(schema.predictionPrograms)
          .set({ rules: { ...DEFAULT_RULES, initialPoints: 2000 } })
          .where(eq(schema.predictionPrograms.seasonId, seasonId)),
      ).rejects.toThrow();
      const merged = await buildUserMergePreflight(
        db,
        { canonicalUserId: f.otherId, mergedUserId: userId },
        { evidenceClass: "super_admin_review" },
      );
      expect(merged.executable).toBe(false);
      expect(merged.items.some((i) => i.key === "predictions:account")).toBe(
        true,
      );
      const publicView = await db.transaction((tx) =>
        predictionBoard(tx, seasonId, null),
      );
      expect(publicView.contests[0]!.submitted).toBeNull();
      expect(publicView.ledger).toEqual([]);
      expect(JSON.stringify(publicView)).not.toContain("example.test");
      expect(JSON.stringify(publicView)).not.toContain(
        "frozenCompetitiveFacts",
      );
      for (const role of ["anon", "authenticated"]) {
        const c = await f.pool.connect();
        try {
          await c.query("BEGIN");
          await c.query(`SET LOCAL ROLE ${role}`);
          await expect(
            c.query("SELECT * FROM prediction_ledger"),
          ).rejects.toThrow();
        } finally {
          await c.query("ROLLBACK");
          c.release();
        }
      }
    }));
  it("judges a complete official Swiss stage and preserves results while simulation remains independent", async () =>
    fixture(async (f) => {
      const { db, seasonId, userId } = f;
      const base = await loadBaseline(db, seasonId);
      const { stage } = fill(base);
      const { id } = (await db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId, seasonId)))[0]!;
      await db.transaction((tx) =>
        savePickInTx(tx, {
          seasonId,
          userId,
          contestId: id,
          pick: stage.pick!,
          submitted: true,
          requestId: randomUUID(),
        }),
      );
      await db.transaction(async (tx) => {
        for (const m of stage.matches) {
          const fields = {
            seasonId,
            stage: "stage1",
            majorStageRunId: f.runId,
            ownership: "major_stage" as const,
            managedKey: m.key,
            round: m.round,
            entryAId: m.a,
            entryBId: m.b,
            format: m.format as "bo1" | "bo3",
            status: "finished" as const,
            scoreA: m.format === "bo1" ? 1 : 2,
            scoreB: 0,
            completedAt: new Date(),
          };
          if (m.round === 1)
            await tx
              .update(schema.matches)
              .set(fields)
              .where(
                and(
                  eq(schema.matches.majorStageRunId, f.runId),
                  eq(schema.matches.managedKey, m.key),
                ),
              );
          else await tx.insert(schema.matches).values(fields);
        }
        await tx
          .update(schema.majorStageRuns)
          .set({ finalizedRound: 5 })
          .where(eq(schema.majorStageRuns.id, f.runId));
      });
      await reconcile(f);
      const board = await db.transaction((tx) =>
        predictionBoard(tx, seasonId, userId),
      );
      expect(board.achievement?.hits).toBe(10);
      expect(board.achievement?.challenges).toBe(2);
      expect(board.achievement?.coin).toBe("青铜");
      expect(board.profit).toBe("0");
      expect(board.balance).toBe("1000");
      const automaticNext = board.contests.find((contest) => contest.stageKey === "stage2")!;
      expect(automaticNext.entrants).toHaveLength(16);
      expect(automaticNext.deadline).toBeNull();
      expect(automaticNext.locked).toBe(false);
      await db.transaction(async (tx) => savePickInTx(tx, {
        seasonId, userId, contestId: automaticNext.id,
        pick: fill(await loadBaseline(tx, seasonId), "stage2").stage.pick!, submitted: true, requestId: randomUUID(),
      }));
      const next = await db.transaction((tx) =>
        transitionMajorSwissStageInTransaction(tx, {
          seasonId,
          sourceStageRunId: f.runId,
          actorId: "test",
        }),
      );
      const bound = await db.transaction((tx) => predictionBoard(tx, seasonId, userId));
      expect(bound.contests.find((contest) => contest.id === automaticNext.id)?.submitted).not.toBeNull();
      const lateId = randomUUID();
      await db
        .insert(schema.users)
        .values({
          id: lateId,
          email: `${lateId}@example.test`,
          emailVerifiedAt: new Date(),
          emailVerificationSource: "admin_migration",
        });
      await db.transaction((tx) =>
        joinPredictionsInTx(tx, { seasonId, userId: lateId }),
      );
      // Joining cannot settle another spectator's historical rights. Initial credit
      // is immediate; the registered runner consumes durable stage entitlement.
      expect(await balance(f)).toBe(BigInt(1000));
      expect(await balance(f,lateId)).toBe(BigInt(1000));
      expect((await db.select().from(schema.predictionJobs).where(eq(schema.predictionJobs.seasonId,seasonId)))[0]?.dirty).toBe(true);
      const [beneficiary]=await db.select().from(schema.predictionAccounts).where(eq(schema.predictionAccounts.userId,userId));
      const stageRewards=()=>db.select().from(schema.predictionLedger).where(and(eq(schema.predictionLedger.accountId,beneficiary!.id),eq(schema.predictionLedger.source,"stage/stage2")));
      expect(await stageRewards()).toHaveLength(0);
      // Fail only if the owed 300-point award has actually been appended inside
      // this transaction; success-without-writing cannot satisfy the fault oracle.
      await db.execute(sql`create function public.w07_reject_award_completion() returns trigger language plpgsql as $$ begin if exists (select 1 from prediction_ledger where season_id = new.season_id and source = 'stage/stage2' and amount = 300) then raise exception 'isolated monetary completion fault'; end if; return new; end $$`);
      await db.execute(sql`create trigger w07_reject_award_completion before update of dirty on prediction_jobs for each row when (new.dirty = false) execute function public.w07_reject_award_completion()`);
      await expect(runPredictionReconciliationJob(db)).rejects.toThrow("Prediction reconciliation failed");
      expect(await stageRewards()).toHaveLength(0);
      expect(await balance(f)).toBe(BigInt(1000));
      expect((await db.select().from(schema.predictionJobs).where(eq(schema.predictionJobs.seasonId,seasonId)))[0]?.dirty).toBe(true);
      await db.execute(sql`drop trigger w07_reject_award_completion on prediction_jobs`);
      await db.execute(sql`drop function public.w07_reject_award_completion()`);
      expect((await runPredictionReconciliationJob(db)).result.completed).toBe(1);
      const awarded=await stageRewards();expect(awarded).toHaveLength(1);expect(awarded[0]!.amount).toBe(BigInt(300));
      expect((await db.select().from(schema.predictionJobs).where(eq(schema.predictionJobs.seasonId,seasonId)))[0]?.dirty).toBe(false);
      await runPredictionReconciliationJob(db);
      expect(await stageRewards()).toHaveLength(1);
      expect(await balance(f)).toBe(BigInt(1300));
      expect(await balance(f, lateId)).toBe(BigInt(1000));
      await db
        .delete(schema.matches)
        .where(eq(schema.matches.majorStageRunId, next.stageRunId));
      await db.delete(schema.majorStageEntrants).where(eq(schema.majorStageEntrants.stageRunId, next.stageRunId));
      await db
        .delete(schema.majorStageRuns)
        .where(eq(schema.majorStageRuns.id, next.stageRunId));
      await db.transaction((tx) =>
        transitionMajorSwissStageInTransaction(tx, {
          seasonId,
          sourceStageRunId: f.runId,
          actorId: "test",
        }),
      );
      await reconcile(f);
      expect(await balance(f)).toBe(BigInt(1300));
      expect(await balance(f, lateId)).toBe(BigInt(1000));

      // Official stage recovery invalidates dependent picks without a Pick’Em moderator.
      await db.delete(schema.matches).where(eq(schema.matches.majorStageRunId, f.runId));
      await db.delete(schema.majorStageEntrants).where(eq(schema.majorStageEntrants.stageRunId, f.runId));
      await db.delete(schema.majorStageRuns).where(eq(schema.majorStageRuns.id, f.runId));
      await reconcile(f);
      const voided = await db.transaction((tx) =>
        predictionBoard(tx, seasonId, userId),
      );
      expect(voided.achievement?.challenges).toBe(0);
      expect(voided.contests.find((contest) => contest.id === id)!.submitted).not.toBeNull();
    }));
});

it("reads started stages from runtime", async () => {
  await fixture(async (f) => {
    const before = await loadBaseline(f.db, f.seasonId);
    await f.db.update(schema.seasons).set({ stagePlan: [] }).where(eq(schema.seasons.id, f.seasonId));
    const after = await loadBaseline(f.db, f.seasonId);
    expect(after.stages).toEqual(before.stages);
    expect(after.runs[0]!.id).toBe(f.runId);
  });
});

it("accepts unscheduled picks, follows postponements while open and latches elapsed deadlines atomically", async () => {
  await fixture(async (f) => {
    const { db, seasonId, userId } = f;
    await db.update(schema.matches).set({ scheduledAt: null }).where(eq(schema.matches.seasonId, seasonId));
    const read = () => db.transaction((tx) => predictionBoard(tx, seasonId, userId));
    const initial = (await read()).contests.find((contest) => contest.stageKey === "stage1")!;
    expect(initial.deadline).toBeNull();
    expect(initial.locked).toBe(false);
    const pick = fill(await loadBaseline(db, seasonId)).stage.pick!;
    await db.transaction((tx) => savePickInTx(tx, { seasonId, userId, contestId: initial.id, pick, submitted: true, requestId: randomUUID() }));
    for (const hours of [2, 3]) {
      const planned = new Date(Date.now() + hours * 3600000);
      await db.update(schema.matches).set({ scheduledAt: planned }).where(eq(schema.matches.seasonId, seasonId));
      const window = (await read()).contests.find((contest) => contest.id === initial.id)!;
      expect(window.deadline).toBe(planned.toISOString());
      expect(window.locked).toBe(false);
    }
    await db.update(schema.matches).set({ scheduledAt: new Date(Date.now() - 1000) }).where(eq(schema.matches.seasonId, seasonId));
    const closed = (await read()).contests.find((contest) => contest.id === initial.id)!;
    expect(closed.locked).toBe(true);
    await db.update(schema.matches).set({ scheduledAt: new Date(Date.now() + 86400000) }).where(eq(schema.matches.seasonId, seasonId));
    const postponed = (await read()).contests.find((contest) => contest.id === initial.id)!;
    expect(postponed.locked).toBe(true);
    expect(postponed.deadline).toBe(closed.deadline);
    await expect(db.transaction((tx) => savePickInTx(tx, { seasonId, userId, contestId: initial.id, pick, submitted: true, requestId: randomUUID() }))).rejects.toThrow("截止");
    expect(postponed.submitted).not.toBeNull();
  });
});

// Admission cannot defer irreversible deadlines. Real transaction failure proves
// that an attempted worker completion cannot consume the durable dirty marker.
it("latches expired admission synchronously and retries real worker failure without losing due work",async()=>fixture(async f=>{
  const {db,seasonId}=f;
  const [contest]=await db.select().from(schema.predictionContests).where(eq(schema.predictionContests.seasonId,seasonId));
  await db.update(schema.predictionJobs).set({dirty:false}).where(eq(schema.predictionJobs.seasonId,seasonId));
  await db.update(schema.predictionContests).set({deadline:new Date(Date.now()-1000)}).where(eq(schema.predictionContests.id,contest!.id));
  const viewer=randomUUID();
  await db.insert(schema.users).values({id:viewer,email:`${viewer}@example.test`,emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration"});
  const before=await db.select().from(schema.predictionJudgements).where(eq(schema.predictionJudgements.contestId,contest!.id));
  await db.transaction(tx=>joinPredictionsInTx(tx,{seasonId,userId:viewer}));
  expect(await balance(f,viewer)).toBe(BigInt(DEFAULT_RULES.initialPoints));
  const [latched]=await db.select().from(schema.predictionContests).where(eq(schema.predictionContests.id,contest!.id));
  expect(latched!.lockedAt).not.toBeNull();
  expect(await db.select().from(schema.predictionJudgements).where(eq(schema.predictionJudgements.contestId,contest!.id))).toEqual(before);
  expect((await db.select().from(schema.predictionJobs).where(eq(schema.predictionJobs.seasonId,seasonId)))[0]?.dirty).toBe(true);
  await db.execute(sql`create function public.w07_reject_completion() returns trigger language plpgsql as $$ begin raise exception 'isolated worker completion fault'; end $$`);
  await db.execute(sql`create trigger w07_reject_completion before update of dirty on prediction_jobs for each row when (new.dirty = false) execute function public.w07_reject_completion()`);
  await expect(runPredictionReconciliationJob(db)).rejects.toThrow("Prediction reconciliation failed");
  expect((await db.select().from(schema.predictionJobs).where(eq(schema.predictionJobs.seasonId,seasonId)))[0]?.dirty).toBe(true);
  await db.execute(sql`drop trigger w07_reject_completion on prediction_jobs`);
  await db.execute(sql`drop function public.w07_reject_completion()`);
  expect((await runPredictionReconciliationJob(db)).result.completed).toBe(1);
  await db.update(schema.matches).set({scheduledAt:new Date(Date.now()+86400000)}).where(eq(schema.matches.seasonId,seasonId));
  await db.transaction(tx=>joinPredictionsInTx(tx,{seasonId,userId:viewer}));
  const [after]=await db.select().from(schema.predictionContests).where(eq(schema.predictionContests.id,contest!.id));
  expect(after!.lockedAt).toEqual(latched!.lockedAt);
  expect(await balance(f,viewer)).toBe(BigInt(DEFAULT_RULES.initialPoints));
}));
