// Adapted from the prediction integration fixture, using scratch databases only.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { createMajorDefaultCapabilities, createMajor24Capabilities } from "@/lib/competition/templates";
import { makeMajorRunSnapshotV4 } from "@/lib/major/run-snapshot";
import { loadBaseline } from "@/lib/predictions/baseline";
import { simulateMajor } from "@/lib/predictions/simulator";
import { syncAutomaticPickEmInTx, joinPredictionsInTx } from "@/lib/predictions/service";
import { localDatabaseUrl } from "../harness/database";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

export type Fixture = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  pool: Pool;
  seasonId: string;
  userId: string;
  otherId: string;
  runId: string;
  matchIds: string[];
};
export async function predictionCapacityFixture(work: (f: Fixture) => Promise<void>, capacity: 24 | 32 = 32, initializePredictions = true) {
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
