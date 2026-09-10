import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { createMajorDefaultCapabilities } from "@/lib/competition/templates";
import { makeMajorRunSnapshotV4 } from "@/lib/major/run-snapshot";
import { DEFAULT_RULES } from "@/lib/predictions/rules";
import { simulateMajor } from "@/lib/predictions/simulator";
import type { Baseline } from "@/lib/predictions/types";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
export async function createPredictionBrowserFixture(
  userId: string,
  adminSetup = false,
) {
  const pool = new Pool({
    connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL),
    ssl: false,
  });
  const db = drizzle(pool, { schema });
  const seasonId = randomUUID(),
    slug = `prediction-browser-${seasonId}`;
  const cap = createMajorDefaultCapabilities();
  const teams: Baseline["teams"] = [];
  try {
    await db.insert(schema.seasons).values({
      ...cap,
      id: seasonId,
      slug,
      name: "观赛预测验收赛",
      kind: "Major",
      competitionTemplate: "major",
      status: "playing",
    });
    const [run] = await db
      .insert(schema.majorStageRuns)
      .values({
        seasonId,
        stageKey: "stage1",
        startedBy: "browser-fixture",
        ruleSnapshot: makeMajorRunSnapshotV4({
          stagePlan: cap.stagePlan.map((s) => ({
            ...s,
            matchFormat: s.matchFormat!,
            finalFormat: s.finalFormat ?? null,
          })),
          rosterRules: { minTeamSize: 5, maxTeamSize: 9, starterCount: 5 },
          affiliationRules: [],
          competitiveProfile: null,
          frozenCompetitiveFacts: [],
        }),
      })
      .returning();
    await db.insert(schema.majorPrestartStates).values({
      seasonId,
      seedsConfirmedAt: new Date(),
      seedsConfirmedBy: "browser-fixture",
      seedsLockedAt: new Date(),
      seedsLockedBy: "browser-fixture",
    });
    for (let i = 1; i <= 32; i++) {
      const teamId = randomUUID(),
        revisionId = randomUUID();
      teams.push({
        teamId,
        tournamentSeed: i,
        name: `队伍 ${String(i).padStart(2, "0")}`,
        logoUrl: null,
      });
      await db.transaction(async (tx) => {
        await tx.insert(schema.competitionEntries).values({
          id: teamId,
          competitionId: seasonId,
          source: "event_native",
          name: teams.at(-1)!.name,
          representativeUserId: userId,
          currentRosterRevisionId: revisionId,
          approvedRosterRevisionId: revisionId,
          registrationStatus: "approved",
        });
        await tx.insert(schema.competitionEntryRepresentativeChanges).values({
          entryId: teamId,
          toUserId: userId,
          changedByActorId: "browser-fixture",
        });
        await tx.insert(schema.competitionEntryRosterRevisions).values({
          id: revisionId,
          entryId: teamId,
          revisionNumber: 1,
          status: "approved",
          approvedAt: new Date(),
          createdBy: "browser-fixture",
        });
      });
      const [entrant] = await db
        .insert(schema.majorTournamentEntrants)
        .values({ seasonId, competitionEntryId: teamId })
        .returning();
      await db
        .insert(schema.majorTournamentSeeds)
        .values({ seasonId, tournamentEntrantId: entrant!.id, seed: i });
      if (i >= 17)
        await db.insert(schema.majorStageEntrants).values({
          seasonId,
          stageRunId: run!.id,
          tournamentEntrantId: entrant!.id,
          stageSeed: i - 16,
        });
    }
    const entrants = teams
      .slice(16)
      .map((t) => ({ teamId: t.teamId, seed: t.tournamentSeed - 16 }));
    const base: Baseline = {
      version: 1,
      seasonId,
      name: "观赛预测验收赛",
      capturedAt: new Date().toISOString(),
      teams,
      runs: [{ key: "stage1", entrants, finalizedRound: 0 }],
      stages: cap.stagePlan.map((s) => ({
        key: s.key,
        name: s.name,
        type: s.type as "swiss" | "single_elim",
        entrySeeds: s.entrySeeds ?? 0,
        matchFormat: s.matchFormat as "bo1" | "bo3",
        finalFormat: s.finalFormat === "bo5" ? "bo5" : null,
      })),
      matches: [],
    };
    const round = simulateMajor(base, {})[0]!.matches;
    const deadline = new Date(Date.now() + 3600000);
    const inserted = await db
      .insert(schema.matches)
      .values(
        round.map((m) => ({
          seasonId,
          majorStageRunId: run!.id,
          ownership: "major_stage" as const,
          managedKey: m.key,
          stage: "stage1",
          round: 1,
          entryAId: m.a,
          entryBId: m.b,
          format: "bo1" as const,
          scheduledAt: deadline,
        })),
      )
      .returning();
    if (adminSetup) {
      await db.insert(schema.seasonAdminGrants).values({ userId, seasonId });
    } else {
      await db
        .insert(schema.predictionPrograms)
        .values({ seasonId, rules: DEFAULT_RULES });
      await db.insert(schema.predictionJobs).values({ seasonId });
      await db.insert(schema.predictionContests).values({
        seasonId,
        stageKey: "stage1",
        kind: "swiss",
        entrants,
        deadline,
      });
      const match = inserted[0]!;
      await db.insert(schema.predictionMarkets).values({
        seasonId,
        matchId: match.id,
        stageKey: "stage1",
        a: match.entryAId,
        b: match.entryBId,
        deadline: new Date(deadline.getTime() - 300000),
      });
    }
    return { slug, seasonId };
  } finally {
    await pool.end();
  }
}
export async function removePredictionBrowserFixture(seasonId: string) {
  const pool = new Pool({
    connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL),
    ssl: false,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role=replica");
    await client.query(
      "DELETE FROM prediction_judgements WHERE contest_id IN (SELECT id FROM prediction_contests WHERE season_id=$1)",
      [seasonId],
    );
    await client.query(
      "DELETE FROM prediction_settlements WHERE market_id IN (SELECT id FROM prediction_markets WHERE season_id=$1)",
      [seasonId],
    );
    for (const table of [
      "prediction_picks",
      "prediction_stakes",
      "prediction_ledger",
      "prediction_scenarios",
      "prediction_accounts",
      "prediction_contests",
      "prediction_markets",
      "prediction_stage_milestones",
      "prediction_jobs",
      "prediction_programs",
      "matches",
      "major_stage_entrants",
      "major_stage_runs",
      "major_tournament_seeds",
      "major_tournament_entrants",
      "major_prestart_states",
      "audit_logs",
      "season_admin_grants",
    ])
      await client.query(`DELETE FROM ${table} WHERE season_id=$1`, [seasonId]);
    for (const table of [
      "competition_entry_representative_changes",
      "competition_entry_roster_revisions",
    ])
      await client.query(
        `DELETE FROM ${table} WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id=$1)`,
        [seasonId],
      );
    await client.query(
      "DELETE FROM competition_entries WHERE competition_id=$1",
      [seasonId],
    );
    await client.query("DELETE FROM seasons WHERE id=$1", [seasonId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
