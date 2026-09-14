import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStageBracket } from "@/lib/bracket";
import { rivalHubEventsResponseSchema } from "@/lib/demo-integration/contracts";
import { readRivalHubEvents } from "@/lib/demo-integration/read";
import { createLocalPool } from "./harness/database";

function bracketEntries(seasonId: string, entryIds: readonly string[]) {
  return entryIds.map((id, index) => ({
    id,
    name: `Team ${index + 1}`,
    competitionId: seasonId,
    formationOrder: index + 1,
  })) as never;
}

describe("DAK stage projection PostgreSQL integration", () => {
  it("keeps standings stage-local and reads Swiss/bracket facts from canonical owners", async () => {
    const pool = createLocalPool();
    const ids = {
      user: randomUUID(),
      season: randomUUID(),
      stageRun: randomUUID(),
      slug: `stage-projection-${randomUUID()}`,
    };
    const entryIds = Array.from({ length: 16 }, () => randomUUID());
    const revisionIds = entryIds.map(() => randomUUID());
    const tournamentEntrantIds = entryIds.map(() => randomUUID());
    const stageEntrantIds = entryIds.map(() => randomUUID());
    const roundRobinMatchIds = Array.from({ length: 3 }, () => randomUUID());
    const roundRobinMapIds = roundRobinMatchIds.map(() => randomUUID());
    const swissMatchIds = Array.from({ length: 8 }, () => randomUUID());
    const playoffMatchId = randomUUID();
    const now = new Date("2026-09-14T00:00:00.000Z");
    const stagePlan = [
      {
        key: "group-stage",
        name: "小组循环赛",
        type: "round_robin",
        teamCount: 3,
        advanceTiers: [{ placement: "*", count: 2 }],
        matchFormat: "bo1",
      },
      {
        key: "playoff",
        name: "淘汰赛",
        type: "single_elim",
        teamCount: 4,
        advanceTiers: [{ placement: "1st", count: 1 }],
        matchFormat: "bo3",
        finalFormat: "bo5",
      },
      {
        key: "swiss",
        name: "瑞士轮",
        type: "swiss",
        teamCount: 16,
        advanceTiers: [{ placement: "*", count: 8 }],
        matchFormat: "bo1",
      },
    ];
    const registrationConfig = {
      allowedPlayerTypes: ["enrolled"],
      rankThreshold: { currentMin: null, peakMin: null },
      maxPerPosition: 1,
      screenshotCount: 0,
      maxTotal: 64,
      mapPool: ["de_ancient"],
    };
    const majorSnapshot = {
      version: 4,
      stagePlan: [{ ...stagePlan[2], finalFormat: null }],
      rosterRules: { minTeamSize: 1, maxTeamSize: 1, starterCount: 1 },
      affiliationRules: [],
      competitiveProfile: null,
      frozenCompetitiveFacts: [],
      runOptions: {},
    };
    const roundRobinBracket = await createStageBracket(
      { key: "group-stage", name: "小组循环赛", type: "round_robin" },
      bracketEntries(ids.season, entryIds.slice(0, 3)),
    );
    const playoffBracket = await createStageBracket(
      { key: "playoff", name: "淘汰赛", type: "single_elim" },
      bracketEntries(ids.season, entryIds.slice(0, 4)),
    );

    try {
      await pool.query(
        `INSERT INTO users (id, email, display_name)
         VALUES ($1, $2, 'Stage Projection Test User')`,
        [ids.user, `${ids.user}@local.test`],
      );
      await pool.query(
        `INSERT INTO seasons (
           id, slug, name, kind, competition_template, status, registration_mode,
           has_captain_voting, has_draft, stage_plan, registration_config,
           team_registration_config, min_team_size, max_team_size, starter_count
         ) VALUES ($1, $2, 'Stage Projection Integration', 'Major', 'major', 'playing', 'team', false, false, $3::json, $4::json, '{}'::json, 1, 1, 1)`,
        [ids.season, ids.slug, JSON.stringify(stagePlan), JSON.stringify(registrationConfig)],
      );

      const entryClient = await pool.connect();
      try {
        await entryClient.query("BEGIN");
        await entryClient.query("SET CONSTRAINTS ALL DEFERRED");
        for (const [index, entryId] of entryIds.entries()) {
          await entryClient.query(
            `INSERT INTO competition_entries (
               id, competition_id, source, name, representative_user_id,
               formation_order, current_roster_revision_id, approved_roster_revision_id, registration_status
             ) VALUES ($1, $2, 'event_native', $3, $4, $5, $6, $6, 'approved')`,
            [entryId, ids.season, `Team ${index + 1}`, ids.user, index + 1, revisionIds[index]],
          );
          await entryClient.query(
            `INSERT INTO competition_entry_roster_revisions (
               id, entry_id, revision_number, status, created_by, approved_at
             ) VALUES ($1, $2, 1, 'approved', 'stage-projection-test', $3)`,
            [revisionIds[index], entryId, now],
          );
        }
        await entryClient.query("COMMIT");
      } catch (error) {
        await entryClient.query("ROLLBACK");
        throw error;
      } finally {
        entryClient.release();
      }

      await pool.query(
        `INSERT INTO competition_stage_bracket_states (competition_id, stage_key, data)
         VALUES ($1, 'group-stage', $2::jsonb), ($1, 'playoff', $3::jsonb)`,
        [ids.season, JSON.stringify(roundRobinBracket.data), JSON.stringify(playoffBracket.data)],
      );
      await pool.query(
        `INSERT INTO major_stage_runs (id, season_id, stage_key, rule_snapshot, finalized_round, started_by)
         VALUES ($1, $2, 'swiss', $3::json, 1, 'stage-projection-test')`,
        [ids.stageRun, ids.season, JSON.stringify(majorSnapshot)],
      );
      await pool.query(
        `INSERT INTO major_tournament_entrants (id, season_id, competition_entry_id)
         VALUES ${tournamentEntrantIds.map((_, index) => `($${index * 2 + 2}, $1, $${index * 2 + 3})`).join(", ")}`,
        [ids.season, ...tournamentEntrantIds.flatMap((entrantId, index) => [entrantId, entryIds[index]])],
      );
      await pool.query(
        `INSERT INTO major_stage_entrants (id, stage_run_id, season_id, tournament_entrant_id, stage_seed)
         VALUES ${stageEntrantIds.map((_, index) => `($${index * 3 + 3}, $1, $2, $${index * 3 + 4}, $${index * 3 + 5})`).join(", ")}`,
        [ids.stageRun, ids.season, ...stageEntrantIds.flatMap((stageEntrantId, index) => [stageEntrantId, tournamentEntrantIds[index], index + 1])],
      );

      const roundRobinPairs: readonly [number, number, number, number][] = [
        [0, 1, 1, 0],
        [0, 2, 0, 1],
        [1, 2, 1, 0],
      ];
      for (const [index, [entryA, entryB, scoreA, scoreB]] of roundRobinPairs.entries()) {
        await pool.query(
          `INSERT INTO matches (
             id, season_id, entry_a_id, entry_b_id, stage, format, status,
             score_a, score_b, completed_at
           ) VALUES ($1, $2, $3, $4, 'group-stage', 'bo1', 'finished', $5, $6, $7)`,
          [roundRobinMatchIds[index], ids.season, entryIds[entryA], entryIds[entryB], scoreA, scoreB, now],
        );
        await pool.query(
          `INSERT INTO match_maps (id, match_id, map_order, map_name, score_a, score_b, completed_at)
           VALUES ($1, $2, 1, 'de_ancient', $3, $4, $5)`,
          [roundRobinMapIds[index], roundRobinMatchIds[index], scoreA === 1 ? 13 : 8, scoreA === 1 ? 8 : 13, now],
        );
      }
      await pool.query(
        `INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, format, status, bracket_node_id)
         VALUES ($1, $2, $3, $4, 'playoff', 'bo3', 'scheduled', '0')`,
        [playoffMatchId, ids.season, entryIds[0], entryIds[1]],
      );
      for (const [index, matchId] of swissMatchIds.entries()) {
        await pool.query(
          `INSERT INTO matches (
             id, season_id, entry_a_id, entry_b_id, stage, round, format, status,
             score_a, score_b, completed_at, ownership, major_stage_run_id, managed_key
           ) VALUES ($1, $2, $3, $4, 'swiss', 1, 'bo1', 'finished', 1, 0, $5, 'major_stage', $6, $7)`,
          [matchId, ids.season, entryIds[index], entryIds[index + 8], now, ids.stageRun, `swiss:1:${index + 1}`],
        );
      }

      const response = rivalHubEventsResponseSchema.parse(await readRivalHubEvents({ seasonIds: [ids.season] }));
      const event = response.events[0]!;
      const groupStage = event.stages.find((stage) => stage.key === "group-stage");
      const playoff = event.stages.find((stage) => stage.key === "playoff");
      const swiss = event.stages.find((stage) => stage.key === "swiss");
      expect(groupStage?.standings).toHaveLength(3);
      expect(groupStage?.standings?.map((standing) => standing.entryId)).not.toContain(entryIds[3]);
      expect(groupStage?.standings?.find((standing) => standing.entryId === entryIds[0])).toMatchObject({ wins: 1, losses: 1 });
      expect(playoff?.bracketNodes).toEqual([
        expect.objectContaining({ id: "0", nextWinNodeId: "2", nextLossNodeId: null }),
        expect.objectContaining({ id: "1", nextWinNodeId: "2", nextLossNodeId: null }),
        expect.objectContaining({ id: "2", nextWinNodeId: null, nextLossNodeId: null }),
      ]);
      expect(swiss?.standings).toHaveLength(16);
      expect(swiss?.standings?.[0]).toEqual(expect.objectContaining({ tiebreakFacts: { BU: expect.any(Number) }, status: expect.any(String) }));
    } finally {
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query("BEGIN");
        await cleanupClient.query("SET LOCAL session_replication_role = replica");
        await cleanupClient.query("DELETE FROM match_maps WHERE match_id = ANY($1::uuid[])", [[...roundRobinMatchIds]]);
        await cleanupClient.query("DELETE FROM matches WHERE season_id = $1", [ids.season]);
        await cleanupClient.query("DELETE FROM competition_stage_bracket_states WHERE competition_id = $1", [ids.season]);
        await cleanupClient.query("DELETE FROM major_stage_entrants WHERE stage_run_id = $1", [ids.stageRun]);
        await cleanupClient.query("DELETE FROM major_tournament_entrants WHERE season_id = $1", [ids.season]);
        await cleanupClient.query("DELETE FROM major_stage_runs WHERE id = $1", [ids.stageRun]);
        await cleanupClient.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id = ANY($1::uuid[])", [entryIds]);
        await cleanupClient.query("DELETE FROM competition_entries WHERE competition_id = $1", [ids.season]);
        await cleanupClient.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
        await cleanupClient.query("DELETE FROM users WHERE id = $1", [ids.user]);
        await cleanupClient.query("COMMIT");
      } catch {
        await cleanupClient.query("ROLLBACK").catch(() => undefined);
      } finally {
        cleanupClient.release();
        await pool.end();
      }
    }
  });
});
