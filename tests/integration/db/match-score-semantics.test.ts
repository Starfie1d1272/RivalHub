import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { localDatabaseUrl } from "./harness/database";

const requireSeasonAdminMock = vi.hoisted(() => vi.fn());
const auditActorIdMock = vi.hoisted(() => vi.fn((session: { userId: string }) => session.userId));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
  auditActorId: auditActorIdMock,
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: vi.fn(),
}));

vi.mock("@/actions/transitions", () => ({
  maybeFinishSeason: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

import {
  correctMapScore,
  forfeitMatch,
  recordMapResult,
  updateMatchStatus,
} from "../../../src/actions/matches/results";
import { saveVetoSteps } from "../../../src/actions/matches/veto";

type MatchFormat = "bo1" | "bo3" | "bo5";

const MAP_POOL = [
  "de_ancient",
  "de_anubis",
  "de_cache",
  "de_dust2",
  "de_inferno",
  "de_mirage",
  "de_nuke",
] as const;

function vetoSteps(format: MatchFormat, entryAId: string, entryBId: string) {
  const maps = MAP_POOL;
  const steps =
    format === "bo1"
      ? [
          ["ban", entryAId], ["ban", entryAId], ["ban", entryBId], ["ban", entryBId],
          ["ban", entryBId], ["ban", entryAId], ["decider", entryBId],
        ]
      : format === "bo3"
        ? [
            ["ban", entryAId], ["ban", entryBId], ["pick", entryAId], ["pick", entryBId],
            ["ban", entryBId], ["ban", entryAId], ["decider", entryBId],
          ]
        : [
            ["ban", entryAId], ["ban", entryBId], ["pick", entryAId], ["pick", entryBId],
            ["pick", entryAId], ["pick", entryBId], ["decider", entryBId],
          ];

  return steps.map(([actionType, entryId], index) => ({
    actionType: actionType as "ban" | "pick" | "decider",
    mapName: maps[index]!,
    entryId,
    side: null as null,
  }));
}

interface Fixture {
  seasonId: string;
  adminId: string;
  entryAId: string;
  entryBId: string;
  memberAId: string;
  memberBId: string;
  eventRosterAId: string;
  eventRosterBId: string;
}

async function createFixture(client: import("pg").PoolClient): Promise<Fixture> {
  const fixture: Fixture = {
    seasonId: randomUUID(),
    adminId: randomUUID(),
    entryAId: randomUUID(),
    entryBId: randomUUID(),
    memberAId: randomUUID(),
    memberBId: randomUUID(),
    eventRosterAId: randomUUID(),
    eventRosterBId: randomUUID(),
  };
  const revisionAId = randomUUID();
  const revisionBId = randomUUID();
  const rosterUserAId = randomUUID();
  const rosterUserBId = randomUUID();

  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)",
      [
        fixture.adminId,
        `score-admin-${fixture.seasonId}@local.test`,
        rosterUserAId,
        `score-a-${fixture.seasonId}@local.test`,
        rosterUserBId,
        `score-b-${fixture.seasonId}@local.test`,
      ],
    );
    await client.query(
      `INSERT INTO seasons (
         id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft,
         stage_plan, registration_config, team_registration_config, min_team_size, max_team_size, starter_count
       ) VALUES ($1, $2, 'Match score semantics', 'Rivals', 'playing', 'team', false, false,
         '[]'::json, $3::json, '{}'::json, 1, 1, 1)`,
      [
        fixture.seasonId,
        `match-score-semantics-${fixture.seasonId}`,
        JSON.stringify({ mapPool: MAP_POOL }),
      ],
    );
    await client.query(
      `INSERT INTO competition_entries (
         id, competition_id, source, name, representative_user_id,
         current_roster_revision_id, approved_roster_revision_id, registration_status
       ) VALUES ($1, $2, 'event_native', 'Score A', $3, $4, $4, 'approved'),
                ($5, $2, 'event_native', 'Score B', $6, $7, $7, 'approved')`,
      [fixture.entryAId, fixture.seasonId, rosterUserAId, revisionAId, fixture.entryBId, rosterUserBId, revisionBId],
    );
    await client.query(
      `INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
       VALUES ($1, NULL, $2, 'score-test'), ($3, NULL, $4, 'score-test')`,
      [fixture.entryAId, rosterUserAId, fixture.entryBId, rosterUserBId],
    );
    await client.query(
      `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
       VALUES ($1, $2, 1, 'approved', 'score-test', now()),
              ($3, $4, 1, 'approved', 'score-test', now())`,
      [revisionAId, fixture.entryAId, revisionBId, fixture.entryBId],
    );
    await client.query(
      `INSERT INTO event_rosters (
         id, entry_id, source_roster_revision_id, status, confirmed_at, confirmed_by, frozen_at, frozen_by
       ) VALUES ($1, $2, $3, 'preparing', NULL, NULL, NULL, NULL),
                ($4, $5, $6, 'preparing', NULL, NULL, NULL, NULL)`,
      [fixture.eventRosterAId, fixture.entryAId, revisionAId, fixture.eventRosterBId, fixture.entryBId, revisionBId],
    );
    await client.query(
      `INSERT INTO event_roster_members (id, event_roster_id, user_id, is_primary_starter)
       VALUES ($1, $2, $3, true), ($4, $5, $6, true)`,
      [fixture.memberAId, fixture.eventRosterAId, rosterUserAId, fixture.memberBId, fixture.eventRosterBId, rosterUserBId],
    );
    await client.query(
      `UPDATE event_rosters
       SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'score-test'
       WHERE id IN ($1, $2)`,
      [fixture.eventRosterAId, fixture.eventRosterBId],
    );
    await client.query(
      `UPDATE event_rosters
       SET status = 'frozen', frozen_at = now(), frozen_by = 'score-test'
       WHERE id IN ($1, $2)`,
      [fixture.eventRosterAId, fixture.eventRosterBId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  return fixture;
}

async function createMatch(
  client: import("pg").PoolClient,
  fixture: Fixture,
  format: MatchFormat,
  options: { withLineups?: boolean } = {},
): Promise<string> {
  const matchId = randomUUID();
  await client.query(
    `INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, format, status)
     VALUES ($1, $2, $3, $4, 'qualifier', $5, 'scheduled')`,
    [matchId, fixture.seasonId, fixture.entryAId, fixture.entryBId, format],
  );

  if (options.withLineups) {
    const rosterAId = randomUUID();
    const rosterBId = randomUUID();
    await client.query(
      `INSERT INTO match_rosters (
         id, match_id, entry_id, submitted_by, source, status, locked_at, confirmed_at, confirmed_by
       ) VALUES ($1, $2, $3, NULL, 'admin_select', 'confirmed', now(), now(), 'score-test'),
                ($4, $2, $5, NULL, 'admin_select', 'confirmed', now(), now(), 'score-test')`,
      [rosterAId, matchId, fixture.entryAId, rosterBId, fixture.entryBId],
    );
    await client.query(
      `INSERT INTO match_roster_players (roster_id, event_roster_member_id, is_starter)
       VALUES ($1, $2, true), ($3, $4, true)`,
      [rosterAId, fixture.memberAId, rosterBId, fixture.memberBId],
    );
  }

  return matchId;
}

async function expectSuccess<T>(resultPromise: Promise<{ success: boolean; data?: T; error?: unknown }>): Promise<T> {
  const result = await resultPromise;
  if (!result.success) throw new Error(`action failed: ${JSON.stringify(result.error)}`);
  expect(result.success).toBe(true);
  return result.data as T;
}

describe("match score persistence semantics PostgreSQL integration", () => {
  it("uses map facts for BO1/BO3/BO5 results and never creates forfeit maps", async () => {
    const pool = new Pool({ connectionString: localDatabaseUrl(), ssl: false, max: 2 });
    const client = await pool.connect();
    let fixture: Fixture | undefined;
    try {
      fixture = await createFixture(client);
      requireSeasonAdminMock.mockResolvedValue({ userId: fixture.adminId, email: `score-admin-${fixture.seasonId}@local.test` });

      const bo1MatchId = await createMatch(client, fixture, "bo1", { withLineups: true });
      const bo3MatchId = await createMatch(client, fixture, "bo3", { withLineups: true });
      const bo5MatchId = await createMatch(client, fixture, "bo5", { withLineups: true });
      const forfeitBo1MatchId = await createMatch(client, fixture, "bo1");
      const forfeitBo3MatchId = await createMatch(client, fixture, "bo3");
      const scoredForfeitMatchId = await createMatch(client, fixture, "bo3", { withLineups: true });

      for (const [matchId, format] of [[bo1MatchId, "bo1"], [bo3MatchId, "bo3"], [bo5MatchId, "bo5"]] as const) {
        await expectSuccess(saveVetoSteps(matchId, { steps: vetoSteps(format, fixture.entryAId, fixture.entryBId) }));
        await expectSuccess(updateMatchStatus(matchId, "in_progress"));
      }
      await expectSuccess(saveVetoSteps(forfeitBo3MatchId, { steps: vetoSteps("bo3", fixture.entryAId, fixture.entryBId) }));
      await expectSuccess(saveVetoSteps(scoredForfeitMatchId, { steps: vetoSteps("bo3", fixture.entryAId, fixture.entryBId) }));
      await expectSuccess(updateMatchStatus(scoredForfeitMatchId, "in_progress"));

      const bo1MapName = MAP_POOL[6]!;
      const bo1Result = await expectSuccess(recordMapResult(bo1MatchId, 1, bo1MapName, 13, 8, null, null));
      expect(bo1Result).toEqual({ seriesFinished: true });
      const bo1MapId = (await client.query<{ id: string }>(
        "SELECT id FROM match_maps WHERE match_id = $1 AND map_name = $2",
        [bo1MatchId, bo1MapName],
      )).rows[0]!.id;
      await expectSuccess(correctMapScore(bo1MapId, 13, 10));

      const bo3Scores = [[13, 8], [10, 13], [13, 7]] as const;
      const bo3MapNames = [MAP_POOL[2], MAP_POOL[3], MAP_POOL[6]] as const;
      for (const [index, [scoreA, scoreB]] of bo3Scores.entries()) {
        await expectSuccess(recordMapResult(bo3MatchId, index + 1, bo3MapNames[index]!, scoreA, scoreB, null, null));
      }

      const bo5Scores = [[13, 8], [10, 13], [13, 7], [8, 13], [13, 10]] as const;
      const bo5MapNames = [MAP_POOL[2], MAP_POOL[3], MAP_POOL[4], MAP_POOL[5], MAP_POOL[6]] as const;
      for (const [index, [scoreA, scoreB]] of bo5Scores.entries()) {
        await expectSuccess(recordMapResult(bo5MatchId, index + 1, bo5MapNames[index]!, scoreA, scoreB, null, null));
      }

      await expectSuccess(recordMapResult(scoredForfeitMatchId, 1, MAP_POOL[2]!, 13, 8, null, null));
      await expectSuccess(forfeitMatch(forfeitBo1MatchId, fixture.entryBId, "BO1 fixture adjudication"));
      await expectSuccess(forfeitMatch(forfeitBo3MatchId, fixture.entryBId, "BO3 fixture adjudication"));
      await expectSuccess(forfeitMatch(scoredForfeitMatchId, fixture.entryBId, "BO3 after one played map"));

      const facts = await client.query<{
        id: string;
        format: MatchFormat;
        status: string;
        score_a: number | null;
        score_b: number | null;
        is_forfeit: boolean;
      }>(
        `SELECT id, format, status, score_a, score_b, is_forfeit
         FROM matches WHERE id IN ($1, $2, $3, $4, $5, $6) ORDER BY id`,
        [bo1MatchId, bo3MatchId, bo5MatchId, forfeitBo1MatchId, forfeitBo3MatchId, scoredForfeitMatchId],
      );
      expect(facts.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: bo1MatchId, format: "bo1", status: "finished", score_a: 1, score_b: 0, is_forfeit: false }),
        expect.objectContaining({ id: bo3MatchId, format: "bo3", status: "finished", score_a: 2, score_b: 1, is_forfeit: false }),
        expect.objectContaining({ id: bo5MatchId, format: "bo5", status: "finished", score_a: 3, score_b: 2, is_forfeit: false }),
        expect.objectContaining({ id: forfeitBo1MatchId, format: "bo1", status: "finished", score_a: 1, score_b: 0, is_forfeit: true }),
        expect.objectContaining({ id: forfeitBo3MatchId, format: "bo3", status: "finished", score_a: 2, score_b: 0, is_forfeit: true }),
        expect.objectContaining({ id: scoredForfeitMatchId, format: "bo3", status: "finished", score_a: 2, score_b: 0, is_forfeit: true }),
      ]));

      const bo1Maps = await client.query<{ map_name: string; score_a: number; score_b: number }>(
        "SELECT map_name, score_a, score_b FROM match_maps WHERE match_id = $1",
        [bo1MatchId],
      );
      expect(bo1Maps.rows).toEqual([{ map_name: bo1MapName, score_a: 13, score_b: 10 }]);

      const bo3Maps = await client.query<{ map_name: string; score_a: number; score_b: number }>(
        "SELECT map_name, score_a, score_b FROM match_maps WHERE match_id = $1 ORDER BY map_order",
        [bo3MatchId],
      );
      expect(bo3Maps.rows).toEqual([
        { map_name: MAP_POOL[2], score_a: 13, score_b: 8 },
        { map_name: MAP_POOL[3], score_a: 10, score_b: 13 },
        { map_name: MAP_POOL[6], score_a: 13, score_b: 7 },
      ]);

      const forfeitMaps = await client.query<{ match_id: string; score_a: number | null; score_b: number | null }>(
        `SELECT match_id, score_a, score_b FROM match_maps
         WHERE match_id IN ($1, $2) ORDER BY match_id, map_order`,
        [forfeitBo1MatchId, forfeitBo3MatchId],
      );
      expect(forfeitMaps.rows).toHaveLength(0);

      const scoredForfeitMaps = await client.query<{ score_a: number; score_b: number }>(
        "SELECT score_a, score_b FROM match_maps WHERE match_id = $1 ORDER BY map_order",
        [scoredForfeitMatchId],
      );
      expect(scoredForfeitMaps.rows).toEqual([{ score_a: 13, score_b: 8 }]);
    } finally {
      client.release();
      if (fixture) {
        const cleanupClient = await pool.connect();
        try {
          await cleanupClient.query("BEGIN");
          await cleanupClient.query("SET LOCAL session_replication_role = replica");
          await cleanupClient.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM match_roster_players WHERE roster_id IN (SELECT id FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1))", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM match_rosters WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM match_veto_steps WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM match_maps WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM matches WHERE season_id = $1", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM event_roster_members WHERE event_roster_id IN (SELECT id FROM event_rosters WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1))", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM event_rosters WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $1)", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM competition_entries WHERE competition_id = $1", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
          await cleanupClient.query("DELETE FROM users WHERE id = $1 OR email LIKE $2", [fixture.adminId, `score-%-${fixture.seasonId}@local.test`]);
          await cleanupClient.query("COMMIT");
        } catch {
          await cleanupClient.query("ROLLBACK").catch(() => undefined);
        } finally {
          cleanupClient.release();
        }
      }
      await pool.end();
    }
  });
});
