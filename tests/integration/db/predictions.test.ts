import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { describe, it, expect } from "vitest";
import * as schema from "@/db/schema";
import { createMajorDefaultCapabilities } from "@/lib/competition/templates";
import { makeMajorRunSnapshotV4 } from "@/lib/major/run-snapshot";
import { finalizeMajorSwissRoundInTransaction } from "@/lib/major/swiss-runtime";
import { transitionMajorSwissStageInTransaction } from "@/lib/major/stage-transition";
import { DEFAULT_RULES } from "@/lib/predictions/rules";
import { loadBaseline } from "@/lib/predictions/baseline";
import { simulateMajor } from "@/lib/predictions/simulator";
import {
  enablePredictionsInTx,
  joinPredictionsInTx,
  openPredictionWindowInTx,
  savePickInTx,
  stakeInTx,
  lockPredictionProgram,
  reconcilePredictionProgram,
  balanceOf,
  saveScenarioInTx,
  moderatePredictionsInTx,
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
async function fixture(work: (f: Fixture) => Promise<void>) {
  await withScratchDatabase("prediction_test", async (client) => {
    for (const file of migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name)))
      await replayMigration(client, file);
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
      const cap = createMajorDefaultCapabilities();
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
      for (let seed = 1; seed <= 32; seed++) {
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
          .filter((e) => e.seed >= 17)
          .map((e) => ({
            seasonId,
            stageRunId: runId,
            tournamentEntrantId: e.id,
            stageSeed: e.seed - 16,
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
            format: "bo1" as const,
            scheduledAt: new Date(Date.now() + 3600000),
          })),
        )
        .returning({ id: schema.matches.id });
      await db.transaction((tx) =>
        enablePredictionsInTx(tx, {
          seasonId,
          rules: DEFAULT_RULES,
          actorId: "test",
        }),
      );
      await Promise.all(
        [userId, otherId].map((id) =>
          db.transaction((tx) =>
            joinPredictionsInTx(tx, { seasonId, userId: id }),
          ),
        ),
      );
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
async function market(f: Fixture, index: number) {
  const { id } = await f.db.transaction((tx) =>
    openPredictionWindowInTx(tx, {
      seasonId: f.seasonId,
      actorId: "test",
      matchId: f.matchIds[index]!,
      deadline: new Date(Date.now() + 1800000),
    }),
  );
  const [m] = await f.db
    .select()
    .from(schema.predictionMarkets)
    .where(eq(schema.predictionMarkets.id, id));
  return m!;
}
function fill(base: Awaited<ReturnType<typeof loadBaseline>>) {
  const choices: Choices = {};
  for (let i = 0; i < 8; i++) {
    const stage = simulateMajor(base, choices)[0]!;
    if (stage.complete) return { stage, choices };
    for (const m of stage.matches.filter((m) => !m.winner))
      choices[`stage1/${m.key}`] = { a: m.a, b: m.b, winner: m.a };
  }
  throw Error("incomplete");
}

describe("spectator prediction PostgreSQL contracts", () => {
  it("keeps versioned submissions separate, blocks late requests, permanently locks on early start and protects identity/history", async () =>
    fixture(async (f) => {
      const { db, seasonId, userId } = f;
      const { id } = await db.transaction((tx) =>
        openPredictionWindowInTx(tx, {
          seasonId,
          actorId: "test",
          stageKey: "stage1",
          deadline: new Date(Date.now() + 1800000),
        }),
      );
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
      const scenario = await db.transaction((tx) =>
        saveScenarioInTx(tx, {
          seasonId,
          userId,
          name: "独立推演",
          choices: complete.choices,
        }),
      );
      expect(scenario.id).toBeTruthy();
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
      await db.transaction((tx) =>
        moderatePredictionsInTx(tx, {
          seasonId,
          actorId: "test",
          paused: true,
          reason: "暂停",
        }),
      );
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
  it("serializes simultaneous ALL IN, retries once, conserves settlement and reverses spent winnings into debt", async () =>
    fixture(async (f) => {
      const first = await market(f, 0);
      const { db, seasonId, userId, otherId } = f;
      const input = {
        seasonId,
        userId,
        marketId: first.id,
        side: first.a,
        amount: "all",
      };
      const concurrent = await Promise.allSettled(
        [1, 2].map(() =>
          db.transaction(async (tx) => {
            await tx.execute(sql`set local lock_timeout='5s'`);
            return stakeInTx(tx, { ...input, requestId: randomUUID() });
          }),
        ),
      );
      expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(
        concurrent
          .filter((r) => r.status === "rejected")
          .map((r) => r.reason.message),
      ).toEqual([expect.stringContaining("积分不足")]);
      const rid = randomUUID();
      await db.transaction((tx) =>
        stakeInTx(tx, {
          ...input,
          userId: otherId,
          side: first.b,
          requestId: rid,
        }),
      );
      await db.transaction((tx) =>
        stakeInTx(tx, {
          ...input,
          userId: otherId,
          side: first.b,
          requestId: rid,
        }),
      );
      expect(await balance(f)).toBe(BigInt(0));
      expect(await balance(f, otherId)).toBe(BigInt(0));
      // Complete the canonical first round; tournament acceptance is separate from finished scores.
      await db
        .update(schema.matches)
        .set({
          status: "finished",
          scoreA: 1,
          scoreB: 0,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(schema.matches.majorStageRunId, f.runId),
            eq(schema.matches.round, 1),
            eq(schema.matches.id, first.matchId),
          ),
        );
      await reconcile(f);
      expect(await balance(f)).toBe(BigInt(0));
      await db
        .update(schema.matches)
        .set({
          status: "finished",
          scoreA: 1,
          scoreB: 0,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(schema.matches.majorStageRunId, f.runId),
            eq(schema.matches.round, 1),
          ),
        );
      await db.transaction((tx) =>
        finalizeMajorSwissRoundInTransaction(tx, {
          seasonId,
          stageRunId: f.runId,
          expectedRound: 1,
          actorId: "test",
        }),
      );
      await reconcile(f);
      const [nextMatch] = await db
        .select()
        .from(schema.matches)
        .where(
          and(
            eq(schema.matches.majorStageRunId, f.runId),
            eq(schema.matches.round, 2),
          ),
        )
        .limit(1);
      f.matchIds.push(nextMatch!.id);
      const second = await market(f, f.matchIds.length - 1);
      expect(await balance(f)).toBe(BigInt(2000));
      await db.transaction((tx) =>
        stakeInTx(tx, {
          seasonId,
          userId,
          marketId: second.id,
          side: second.a,
          amount: "all",
          requestId: randomUUID(),
        }),
      );
      expect(await balance(f)).toBe(BigInt(0));
      await db
        .update(schema.matches)
        .set({ scoreA: 0, scoreB: 1 })
        .where(eq(schema.matches.id, first.matchId));
      const queued = await db
        .select()
        .from(schema.predictionJobs)
        .where(eq(schema.predictionJobs.seasonId, seasonId));
      expect(queued[0]!.dirty).toBe(true);
      await reconcile(f);
      await reconcile(f);
      expect(await balance(f)).toBe(BigInt(-2000));
      expect(await balance(f, otherId)).toBe(BigInt(2000));
      const board = await db.transaction((tx) =>
        predictionBoard(tx, seasonId, userId),
      );
      expect(board.profit).toBe("-1000");
      expect(board.ledger.filter((l) => l.kind === "reversal")).toHaveLength(1);
      await db
        .update(schema.matches)
        .set({ status: "cancelled" })
        .where(eq(schema.matches.id, second.matchId));
      await reconcile(f);
      expect(await balance(f)).toBe(BigInt(0));
      await db.transaction((tx) =>
        joinPredictionsInTx(tx, { seasonId, userId }),
      );
      expect(await balance(f)).toBe(BigInt(0));
      const total = await db
        .select({
          amount: sql<string>`sum(${schema.predictionLedger.amount})::text`,
        })
        .from(schema.predictionLedger)
        .where(eq(schema.predictionLedger.seasonId, seasonId));
      expect(total[0]!.amount).toBe("2000");
      await expect(
        db.transaction((tx) =>
          stakeInTx(tx, { ...input, requestId: randomUUID() }),
        ),
      ).rejects.toThrow("关闭");
    }));
  it("judges a complete official Swiss stage and preserves results while simulation remains independent", async () =>
    fixture(async (f) => {
      const { db, seasonId, userId } = f;
      const base = await loadBaseline(db, seasonId);
      const { stage } = fill(base);
      const { id } = await db.transaction((tx) =>
        openPredictionWindowInTx(tx, {
          seasonId,
          actorId: "test",
          stageKey: "stage1",
          deadline: new Date(Date.now() + 1800000),
        }),
      );
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
      const board = await db.transaction((tx) =>
        predictionBoard(tx, seasonId, userId),
      );
      expect(board.achievement?.hits).toBe(10);
      expect(board.achievement?.challenges).toBe(2);
      expect(board.achievement?.coin).toBe("青铜");
      expect(board.profit).toBe("0");
      expect(board.balance).toBe("1000");
      const next = await db.transaction((tx) =>
        transitionMajorSwissStageInTransaction(tx, {
          seasonId,
          sourceStageRunId: f.runId,
          actorId: "test",
        }),
      );
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
      expect(await balance(f)).toBe(BigInt(1300));
      expect(await balance(f, lateId)).toBe(BigInt(1000));
      await db
        .delete(schema.matches)
        .where(eq(schema.matches.majorStageRunId, next.stageRunId));
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

      await db.transaction((tx) =>
        moderatePredictionsInTx(tx, {
          seasonId,
          actorId: "test",
          contestId: id,
          reason: "赛段作废",
        }),
      );
      const voided = await db.transaction((tx) =>
        predictionBoard(tx, seasonId, userId),
      );
      expect(voided.achievement?.challenges).toBe(0);
      expect(voided.contests[0]!.submitted).not.toBeNull();
    }));
});
