import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { createMajorDefaultCapabilities } from "@/lib/competition/templates";
import { makeMajorRunSnapshotV4 } from "@/lib/major/run-snapshot";
import { defaultPredictionRules } from "@/lib/predictions/rules";
import { officialPickEmStages } from "@/lib/predictions/lifecycle";
import { simulateMajor } from "@/lib/predictions/simulator";
import { projectPredictionStages } from "@/lib/predictions/stage-projection";
import { SIMULATION_VERSION } from "@/lib/predictions/types";
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
      const colors = [
        "#ffcf32",
        "#29d9c6",
        "#ee476d",
        "#69b1ff",
        "#a3de54",
        "#bd8aff",
      ];
      const logoUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path d="M40 4 70 20 65 58 40 76 15 58 10 20Z" fill="${colors[(i - 1) % colors.length]}"/><path d="M26 22 40 12 54 22 50 50 40 62 30 50Z" fill="#101827"/><text x="40" y="45" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="bold" fill="white">${i}</text></svg>`)}`;
      teams.push({
        teamId,
        tournamentSeed: i,
        name: `队伍 ${String(i).padStart(2, "0")}`,
        logoUrl,
      });
      await db.transaction(async (tx) => {
        await tx.insert(schema.competitionEntries).values({
          id: teamId,
          competitionId: seasonId,
          source: "event_native",
          name: teams.at(-1)!.name,
          logoUrl,
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
      version: SIMULATION_VERSION,
      seasonId,
      name: "观赛预测验收赛",
      capturedAt: new Date().toISOString(),
      teams,
      runs: [{ id: run!.id, key: "stage1", entrants, finalizedRound: 0 }],
      stages: projectPredictionStages(cap.stagePlan),
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
    // Browser fixtures use canonical pure policy; real transition hooks are covered in PostgreSQL tests.
    await db.insert(schema.predictionPrograms).values({ seasonId, rules: defaultPredictionRules(base.stages) });
    await db.insert(schema.predictionJobs).values({ seasonId });
    await db.insert(schema.predictionContests).values(officialPickEmStages(base).map((stage) => ({
      seasonId, stageKey: stage.key, kind: stage.kind,
      stageRunId: stage.stageRunId, entrants: stage.entrants, deadline,
    })));
    if (adminSetup) {
      await db.insert(schema.seasonAdminGrants).values({ userId, seasonId });
    } else {
      const match = requireCompetitionMatch(inserted[0]!);
      const [market] = await db
        .insert(schema.predictionMarkets)
        .values({
          seasonId,
          matchId: match.id,
          stageKey: "stage1",
          title: "比赛胜者",
          resolver: "match_winner",
          subject: {
            stageRunId: run!.id,
            entryIds: [match.entryAId, match.entryBId],
          },
          deadline: new Date(deadline.getTime() - 300000),
        })
        .returning();
      await db
        .insert(schema.predictionMarketOptions)
        .values(
          [match.entryAId, match.entryBId].map((id, position) => ({
            marketId: market!.id,
            key: id,
            entryId: id,
            label: teams.find((team) => team.teamId === id)!.name,
            position,
          })),
        );
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
    await client.query(
      "DELETE FROM prediction_market_options WHERE market_id IN (SELECT id FROM prediction_markets WHERE season_id=$1)",
      [seasonId],
    );
    await client.query("DELETE FROM bet_settlements WHERE market_id IN (SELECT id FROM bet_markets WHERE season_id=$1)", [seasonId]);
    await client.query("DELETE FROM bet_options WHERE market_id IN (SELECT id FROM bet_markets WHERE season_id=$1)", [seasonId]);
    for (const table of [
      "bet_stakes", "bet_ledger", "bet_accounts", "bet_markets", "bet_stage_milestones", "bet_programs",
      "prediction_picks",
      "prediction_stakes",
      "prediction_ledger",
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
