import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/db/schema";
import { startMajorInTransaction } from "../../src/lib/major/start";
import { finalizeMajorSwissRoundInTransaction } from "../../src/lib/major/swiss-runtime";
import { transitionMajorSwissStageInTransaction } from "../../src/lib/major/stage-transition";
import { finalizeMajorPlayoffRoundInTransaction, startMajorPlayoffInTransaction } from "../../src/lib/major/playoff-runtime";
import { projectMajorSwissStage, type MajorSwissMatchFact } from "../../src/lib/major/swiss";
import { AppError, ErrorCode } from "../../src/lib/errors";
import { createMajorDefaultCapabilities, type CompetitiveProfileConfig } from "../../src/types/season";
import { createPerfectWorldRankOrder } from "../../src/lib/config/perfect-world";
import {
  applyResultCorrectionInTx,
  planResultCorrectionInTx,
} from "../../src/lib/match-corrections/service";
import {
  archiveTournamentInTx,
  confirmMajorFinalResultInTx,
  createPostEventAdjudicationInTx,
  grantTournamentHonorInTx,
  revokeTournamentHonorInTx,
} from "../../src/lib/postevent/service";
import { lockMatchInTx } from "../../src/lib/match-rosters/service";

const GOLDEN_PROFILE: CompetitiveProfileConfig = {
  platform: "perfect_world",
  currentSeasonKey: "golden-major-2026-current",
  previousSeasonKey: "golden-major-2026-previous",
  rankOrder: createPerfectWorldRankOrder(),
};

function deterministicUuid(scope: string): string {
  const hex = createHash("sha256").update(`rivalhub-golden-major:${scope}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(parseInt(hex.slice(16, 18), 16) & 0x3f | 0x80).toString(16).padStart(2, "0")}${hex.slice(18, 20)}-${hex.slice(20)}`;
}

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("Major 正式开赛集成测试只允许 Local Supabase loopback 数据库。");
}

let expectedErrorIndex = 0;

async function expectPgError(client: PoolClient, work: () => Promise<unknown>, code: string): Promise<void> {
  const savepoint = `expected_error_${expectedErrorIndex++}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await work();
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code) return;
    throw error;
  }
  throw new Error(`预期 PostgreSQL 错误 ${code}，但操作成功。`);
}

interface MajorFixture {
  seasonId: string;
  userIds: string[];
}

interface GoldenSwissEvidenceRow {
  currentSeed: number;
  initialStageSeed: number;
  tournamentSeed: number;
  team: string;
  record: string;
  difficultyScore: number;
  status: string;
}

interface GoldenPlayoffEvidenceRow {
  round: string;
  format: string;
  teamA: string;
  teamB: string;
  score: string;
  status: string;
}

interface GoldenFinalEvidence {
  status: string;
  seasonStatus: string;
  champion: string;
  placementGroups: Array<{ from: number; to: number; teams: string[] }>;
  thirdPlace: string;
  honors: string;
  postArchiveAdjudication: string;
}

async function prepareReadyMajor(pool: Pool, label: string): Promise<MajorFixture> {
  const client = await pool.connect();
  const seasonId = deterministicUuid(`${label}/season`);
  const entryIds = Array.from({ length: 32 }, (_, index) => deterministicUuid(`${label}/entry/${index + 1}`));
  const eventRosterIds = Array.from({ length: 32 }, (_, index) => deterministicUuid(`${label}/event-roster/${index + 1}`));
  const revisionIds = Array.from({ length: 32 }, (_, index) => deterministicUuid(`${label}/revision/${index + 1}`));
  const userIds = Array.from({ length: 160 }, (_, index) => deterministicUuid(`${label}/user/${index + 1}`));
  const capabilities = createMajorDefaultCapabilities();
  capabilities.teamRegistrationConfig.competitiveProfile = GOLDEN_PROFILE;
  const njuInstitution = await client.query<{ id: string }>(
    "SELECT id FROM institutions WHERE moe_institution_code = '4132010284'",
  );
  const externalInstitution = await client.query<{ id: string }>(
    "SELECT id FROM institutions WHERE moe_institution_code = '4111010003'",
  );
  const njuInstitutionId = njuInstitution.rows[0]?.id;
  const externalInstitutionId = externalInstitution.rows[0]?.id;
  if (!njuInstitutionId || !externalInstitutionId) throw new Error("Golden fixture 缺少学校目录基线。 ");

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO competitive_platform_seasons (id, platform, season_key, label, rank_order, sort_order, is_current)
       VALUES ($1, $2, $3, 'Golden current', $4::json, 1, true), ($5, $2, $6, 'Golden previous', $4::json, 0, false)
       ON CONFLICT (platform, season_key) DO UPDATE SET label = EXCLUDED.label, rank_order = EXCLUDED.rank_order, sort_order = EXCLUDED.sort_order, is_current = EXCLUDED.is_current, active = true, updated_at = now()`,
      [
        deterministicUuid("catalog/current"), GOLDEN_PROFILE.platform, GOLDEN_PROFILE.currentSeasonKey,
        JSON.stringify(GOLDEN_PROFILE.rankOrder), deterministicUuid("catalog/previous"), GOLDEN_PROFILE.previousSeasonKey,
      ],
    );
    await client.query(
      `INSERT INTO seasons (
        id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions
      ) VALUES ($1, $2, 'Local Major Start', 'Major', 'registration', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
      [
        seasonId, `local-golden-major-2026-08-${label}`,
        capabilities.registrationMode, capabilities.hasCaptainVoting, capabilities.hasDraft,
        JSON.stringify(capabilities.stagePlan), JSON.stringify(capabilities.registrationConfig),
        JSON.stringify(capabilities.teamRegistrationConfig), JSON.stringify(capabilities.affiliationRules),
        capabilities.minTeamSize, capabilities.maxTeamSize, capabilities.starterCount, capabilities.positions,
      ],
    );
    await client.query(
      `INSERT INTO users (id, email, email_verified_at, display_name, steam_name, perfect_name, perfect_id, steam64, steam_profile_url, qq, student_id)
       SELECT value::uuid,
              'golden-major-' || $2 || '-' || ordinal || '@local.test',
              now(),
              'Golden ' || $2 || ' Player ' || ordinal,
              'Golden ' || $2 || ' Steam ' || ordinal,
              'Golden ' || $2 || ' Perfect Name ' || ordinal,
              'golden-perfect-' || $2 || '-' || ordinal,
              lpad((76561198000000000 + ordinal)::text, 17, '0'),
              'https://steamcommunity.com/profiles/' || lpad((76561198000000000 + ordinal)::text, 17, '0'),
              (10000000 + ordinal)::text,
              'legacy-student-' || ordinal
       FROM unnest($1::text[]) WITH ORDINALITY AS input(value, ordinal)`,
      [userIds, label],
    );
    const educationRows = userIds.map((userId, index) => ({
      id: deterministicUuid(`${label}/education/${index + 1}`),
      userId,
      institutionId: index % 5 < 3 ? njuInstitutionId : externalInstitutionId,
      academicStatus: index % 7 === 0 ? "graduated" : "enrolled",
    }));
    await client.query(
      `INSERT INTO education_verifications (id, user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
       VALUES ${educationRows.map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4}, 'manual_other', 'approved', 'local-admin', now())`).join(", ")}`,
      educationRows.flatMap((row) => [row.id, row.userId, row.institutionId, row.academicStatus]),
    );
    const rankRows = userIds.flatMap((userId, index) => {
      const rank = index % 5 < 3 ? GOLDEN_PROFILE.rankOrder[10]! : GOLDEN_PROFILE.rankOrder[7]!;
      return [
        { id: deterministicUuid(`${label}/rank/${index + 1}/historical`), kind: "historical_peak", seasonKey: null, rank, rating: index % 5 < 3 ? "1800.00" : "1500.00" },
        { id: deterministicUuid(`${label}/rank/${index + 1}/previous`), kind: "season_peak", seasonKey: GOLDEN_PROFILE.previousSeasonKey, rank, rating: index % 5 < 3 ? "1750.00" : "1450.00" },
        { id: deterministicUuid(`${label}/rank/${index + 1}/current`), kind: "season_peak", seasonKey: GOLDEN_PROFILE.currentSeasonKey, rank, rating: index % 5 < 3 ? "1700.00" : "1400.00" },
      ].map((fact) => ({ ...fact, userId }));
    });
    await client.query(
      `INSERT INTO competitive_rank_facts (id, user_id, platform, kind, platform_season_key, rank, rating)
       VALUES ${rankRows.map((_, index) => `($${index * 7 + 1}, $${index * 7 + 2}, $${index * 7 + 3}, $${index * 7 + 4}, $${index * 7 + 5}, $${index * 7 + 6}, $${index * 7 + 7})`).join(", ")}`,
      rankRows.flatMap((row) => [row.id, row.userId, GOLDEN_PROFILE.platform, row.kind, row.seasonKey, row.rank, row.rating]),
    );
    for (let index = 0; index < 32; index += 1) {
      const entryId = entryIds[index]!;
      const memberUsers = userIds.slice(index * 5, index * 5 + 5);
      await client.query(
        `INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, registration_status, approved_roster_revision, perfect_team_id)
         VALUES ($1, $2, 'event_native', $3, $4, 'approved', 1, $5)`,
        [entryId, seasonId, `Golden Team ${index + 1}`, memberUsers[0], `golden-team-${index + 1}`],
      );
      for (let offset = 0; offset < 5; offset += 1) {
        await client.query(
          `INSERT INTO competition_entry_participants (id, entry_id, user_id, status, confirmed_at, invited_by_user_id)
           VALUES ($1, $2, $3, 'confirmed', now(), $4)`,
          [deterministicUuid(`${label}/participant/${index * 5 + offset + 1}`), entryId, memberUsers[offset], memberUsers[0]],
        );
      }
      await client.query(
        `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision, status, created_by, approved_at)
         VALUES ($1, $2, 1, 'approved', 'local-admin', now())`,
        [revisionIds[index], entryId],
      );
      for (let offset = 0; offset < 5; offset += 1) {
        await client.query(
          `INSERT INTO competition_entry_roster_members (revision_id, participant_id, user_id, is_primary_starter)
           VALUES ($1, $2, $3, $4)`,
          [revisionIds[index], deterministicUuid(`${label}/participant/${index * 5 + offset + 1}`), memberUsers[offset], offset === 0],
        );
      }
      await client.query(
        `INSERT INTO event_rosters (id, entry_id, source_roster_revision_id, status)
         VALUES ($1, $2, $3, 'preparing')`,
        [eventRosterIds[index], entryId, revisionIds[index]],
      );
      for (let offset = 0; offset < 5; offset += 1) {
        const verificationId = deterministicUuid(`${label}/education/${index * 5 + offset + 1}`);
        await client.query(
          `INSERT INTO event_roster_members (id, event_roster_id, participant_id, user_id, education_verification_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [deterministicUuid(`${label}/event-roster-member/${index * 5 + offset + 1}`), eventRosterIds[index], deterministicUuid(`${label}/participant/${index * 5 + offset + 1}`), memberUsers[offset], verificationId],
        );
      }
      await client.query(`UPDATE event_rosters SET status = 'confirmed' WHERE id = $1`, [eventRosterIds[index]]);
      await client.query(`UPDATE event_rosters SET status = 'frozen', frozen_at = now(), frozen_by = 'local-admin' WHERE id = $1`, [eventRosterIds[index]]);
    }
    await client.query(
      `INSERT INTO major_prestart_states (season_id, entrants_locked_at, entrants_locked_by, seed_revision, confirmed_seed_revision)
       VALUES ($1, now(), 'local-admin', 1, 1)`,
      [seasonId],
    );
    for (let index = 0; index < 32; index += 1) {
      const entrant = await client.query<{ id: string }>(
        `INSERT INTO major_prestart_entrants (id, season_id, competition_entry_id, event_roster_id, roster_confirmed_at, roster_confirmed_by)
         VALUES ($1, $2, $3, $4, now(), 'local-admin') RETURNING id`,
        [deterministicUuid(`${label}/entrant/${index + 1}`), seasonId, entryIds[index], eventRosterIds[index]],
      );
      const entrantId = entrant.rows[0]?.id;
      if (!entrantId) throw new Error("正式参赛队创建失败。");
      await client.query(
        `INSERT INTO major_tournament_seeds (id, season_id, entrant_id, tournament_seed) VALUES ($1, $2, $3, $4)`,
        [deterministicUuid(`${label}/seed/${index + 1}`), seasonId, entrantId, index + 1],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { seasonId, userIds };
}

async function cleanupMajorFixture(pool: Pool, fixture: MajorFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM matches WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM tournament_honors WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM post_event_adjudications WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_final_results WHERE season_id = $1", [fixture.seasonId]);
    await client.query(`DELETE FROM major_stage_entrants e USING major_stage_runs r
      WHERE e.stage_run_id = r.id AND r.season_id = $1`, [fixture.seasonId]);
    await client.query("DELETE FROM major_stage_runs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_seeds WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_prestart_entrants WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.seasonId]);
    // Frozen-roster immutability is intentional in normal operation; the local
    // test teardown bypasses row triggers to delete its own fixture rows only.
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(`DELETE FROM event_roster_members WHERE event_roster_id IN (
      SELECT id FROM event_rosters WHERE entry_id IN (
        SELECT id FROM competition_entries WHERE competition_id = $1
      )
    )`, [fixture.seasonId]);
    await client.query("SET LOCAL session_replication_role = DEFAULT");
    await client.query(`DELETE FROM event_rosters WHERE entry_id IN (
      SELECT id FROM competition_entries WHERE competition_id = $1
    )`, [fixture.seasonId]);
    await client.query(`DELETE FROM competition_entry_roster_members WHERE revision_id IN (
      SELECT id FROM competition_entry_roster_revisions WHERE entry_id IN (
        SELECT id FROM competition_entries WHERE competition_id = $1
      )
    )`, [fixture.seasonId]);
    await client.query(`DELETE FROM competition_entry_roster_revisions WHERE entry_id IN (
      SELECT id FROM competition_entries WHERE competition_id = $1
    )`, [fixture.seasonId]);
    await client.query(`DELETE FROM competition_entry_participants WHERE entry_id IN (
      SELECT id FROM competition_entries WHERE competition_id = $1
    )`, [fixture.seasonId]);
    await client.query("DELETE FROM competition_entries WHERE competition_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [fixture.userIds]);
    await client.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [fixture.userIds]);
    await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [fixture.userIds]);
    await client.query(
      "DELETE FROM competitive_platform_seasons WHERE platform = $1 AND season_key = ANY($2::text[])",
      [GOLDEN_PROFILE.platform, [GOLDEN_PROFILE.currentSeasonKey, GOLDEN_PROFILE.previousSeasonKey]],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Remove only the namespaced fixtures left by an interrupted earlier run. */
async function cleanupStaleMajorStartFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const fixtures = await client.query<{ season_id: string; user_ids: string[] }>(`
      SELECT s.id AS season_id, COALESCE(array_agg(DISTINCT p.user_id) FILTER (WHERE p.user_id IS NOT NULL), '{}') AS user_ids
      FROM seasons s
      LEFT JOIN competition_entries e ON e.competition_id = s.id
      LEFT JOIN competition_entry_participants p ON p.entry_id = e.id
      WHERE s.slug LIKE 'local-major-start-%' OR s.slug LIKE 'local-golden-major-2026-08-%'
      GROUP BY s.id
    `);
    for (const fixture of fixtures.rows) {
      await cleanupMajorFixture(pool, { seasonId: fixture.season_id, userIds: fixture.user_ids });
    }
  } finally {
    client.release();
  }
}

async function expectSwissRuntimeFailure(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.VALIDATION_FAILED) return;
    throw error;
  }
  throw new Error("预期 Swiss 运行时拒绝不完整或非法比赛事实，但操作成功。 ");
}

async function finishSwissRound(pool: Pool, stageRunId: string, round: number): Promise<void> {
  const client = await pool.connect();
  try {
    const roundMatches = await client.query<{ id: string; format: "bo1" | "bo3" }>(
      `SELECT id, format FROM matches
       WHERE major_stage_run_id = $1 AND ownership = 'major_stage' AND round = $2
       ORDER BY managed_key`,
      [stageRunId, round],
    );
    if (roundMatches.rows.length === 0) throw new Error(`第 ${round} 轮没有可完成的托管比赛。`);
    for (let index = 0; index < roundMatches.rows.length; index += 1) {
      const match = roundMatches.rows[index];
      const teamAWins = (round + index) % 2 === 0;
      const scoreA = match.format === "bo1" ? (teamAWins ? 13 : 11) : (teamAWins ? 2 : 1);
      const scoreB = match.format === "bo1" ? (teamAWins ? 11 : 13) : (teamAWins ? 1 : 2);
      await client.query(
        `UPDATE matches SET score_a = $2, score_b = $3, status = 'finished', completed_at = now(), updated_at = now() WHERE id = $1`,
        [match.id, scoreA, scoreB],
      );
    }
  } finally {
    client.release();
  }
}

async function readSwissEvidence(pool: Pool, stageRunId: string): Promise<GoldenSwissEvidenceRow[]> {
  const entrants = await pool.query<{ competition_entry_id: string; entry_name: string; stage_seed: number; tournament_seed: number }>(`
    SELECT e.competition_entry_id, en.name AS entry_name, e.stage_seed, e.tournament_seed
    FROM major_stage_entrants e
    INNER JOIN competition_entries en ON en.id = e.competition_entry_id
    WHERE e.stage_run_id = $1
    ORDER BY e.stage_seed
  `, [stageRunId]);
  const matches = await pool.query<{
    id: string;
    round: number | null;
    entry_a_id: string;
    entry_b_id: string;
    score_a: number | null;
    score_b: number | null;
    status: string;
    completed_at: Date | null;
  }>(`
    SELECT id, round, entry_a_id, entry_b_id, score_a, score_b, status, completed_at
    FROM matches
    WHERE major_stage_run_id = $1 AND ownership = 'major_stage'
    ORDER BY round, managed_key
  `, [stageRunId]);
  if (entrants.rows.length !== 16) throw new Error("Golden evidence 缺少 16 个 StageRun entrant 表项。 ");
  const facts: MajorSwissMatchFact[] = matches.rows.map((match) => {
    if (match.round === null || match.round < 1 || match.round > 5 || match.status !== "finished" || match.completed_at === null || match.score_a === null || match.score_b === null || match.score_a === match.score_b) {
      throw new Error("Golden evidence 发现未完成或无胜者的 Swiss 比赛。 ");
    }
    return {
      matchId: match.id,
      round: match.round as 1 | 2 | 3 | 4 | 5,
      entryAId: match.entry_a_id,
      entryBId: match.entry_b_id,
      winnerId: match.score_a > match.score_b ? match.entry_a_id : match.entry_b_id,
    };
  });
  const projection = projectMajorSwissStage({
    entrants: entrants.rows.map((entrant) => ({ teamId: entrant.competition_entry_id, initialStageSeed: entrant.stage_seed })),
    matches: facts,
    finalizedRound: 5,
  });
  const metadata = new Map(entrants.rows.map((entrant) => [entrant.competition_entry_id, entrant]));
  return projection.teams.map((team) => {
    const entrant = metadata.get(team.teamId);
    if (!entrant) throw new Error("Golden evidence 的 Swiss 投影引用了未知 Entry。 ");
    return {
      currentSeed: team.currentStageSeed,
      initialStageSeed: team.initialStageSeed,
      tournamentSeed: entrant.tournament_seed,
      team: entrant.entry_name,
      record: `${team.wins}-${team.losses}`,
      difficultyScore: team.difficultyScore,
      status: team.status,
    };
  });
}

async function readPlayoffEvidence(pool: Pool, stageRunId: string): Promise<GoldenPlayoffEvidenceRow[]> {
  const result = await pool.query<{
    entry_round: string | null;
    format: string;
    team_a: string;
    team_b: string;
    score_a: number | null;
    score_b: number | null;
    status: string;
  }>(`
    SELECT m.entry_round, m.format, ta.name AS team_a, tb.name AS team_b, m.score_a, m.score_b, m.status
    FROM matches m
    INNER JOIN competition_entries ta ON ta.id = m.entry_a_id
    INNER JOIN competition_entries tb ON tb.id = m.entry_b_id
    WHERE m.major_stage_run_id = $1 AND m.ownership = 'major_stage'
    ORDER BY CASE m.entry_round WHEN 'quarterfinal' THEN 1 WHEN 'semifinal' THEN 2 WHEN 'third_place' THEN 3 WHEN 'final' THEN 4 ELSE 5 END, m.managed_key
  `, [stageRunId]);
  return result.rows.map((match) => ({
    round: match.entry_round ?? "unknown",
    format: match.format,
    teamA: match.team_a,
    teamB: match.team_b,
    score: match.score_a === null || match.score_b === null ? "—" : `${match.score_a}:${match.score_b}`,
    status: match.status,
  }));
}

async function readFinalEvidence(pool: Pool, seasonId: string, playoffRunId: string): Promise<GoldenFinalEvidence> {
  const result = await pool.query<{
    status: string;
    champion: string;
    season_status: string;
    placement_groups: unknown;
  }>(`
    SELECT r.status, champion.name AS champion, s.status AS season_status, r.placement_groups
    FROM major_final_results r
    INNER JOIN competition_entries champion ON champion.id = r.champion_entry_id
    INNER JOIN seasons s ON s.id = r.season_id
    WHERE r.season_id = $1 AND r.playoff_stage_run_id = $2
  `, [seasonId, playoffRunId]);
  const row = result.rows[0];
  if (!row || !Array.isArray(row.placement_groups)) throw new Error("Golden evidence 缺少正式名次结果。 ");
  const entryRows = await pool.query<{ id: string; name: string }>("SELECT id, name FROM competition_entries WHERE competition_id = $1", [seasonId]);
  const entryNames = new Map(entryRows.rows.map((entry) => [entry.id, entry.name]));
  const placementGroups = row.placement_groups.map((group) => {
    if (typeof group !== "object" || group === null) {
      throw new Error("Golden evidence 的 placement group 结构无效。 ");
    }
    const candidate = group as { from?: unknown; to?: unknown; entryIds?: unknown };
    if (!Array.isArray(candidate.entryIds)) throw new Error("Golden evidence 的 placement group 结构无效。 ");
    const from = Number(candidate.from);
    const to = Number(candidate.to);
    const teams = candidate.entryIds.map((entryId: unknown) => entryNames.get(String(entryId)) ?? `unknown:${String(entryId)}`);
    return { from, to, teams };
  });
  const third = placementGroups.find((group) => group.from === 3 && group.to === 3)?.teams.join(", ") ?? "—";
  return {
    status: row.status,
    seasonStatus: row.season_status,
    champion: row.champion,
    placementGroups,
    thirdPlace: third,
    honors: "champion revoked; runner_up valid; no auto-promotion",
    postArchiveAdjudication: "allowed",
  };
}

async function exerciseSwissRuntime(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  fixture: MajorFixture,
): Promise<string> {
  const stageRun = await pool.query<{ id: string }>(
    "SELECT id FROM major_stage_runs WHERE season_id = $1 AND stage_key = 'stage1'",
    [fixture.seasonId],
  );
  const stageRunId = stageRun.rows[0]?.id;
  if (!stageRunId) throw new Error("Stage 1 StageRun 不存在。 ");
  await expectSwissRuntimeFailure(() => database.transaction((tx) => finalizeMajorSwissRoundInTransaction(tx, {
    seasonId: fixture.seasonId, stageRunId, expectedRound: 1, actorId: "local-admin",
  })));

  await finishSwissRound(pool, stageRunId, 1);
  const client = await pool.connect();
  let corruptedMatchId: string;
  try {
    const invalid = await client.query<{ id: string }>(
      `SELECT id FROM matches WHERE season_id = $1 AND ownership = 'major_stage' AND round = 1 ORDER BY managed_key LIMIT 1`,
      [fixture.seasonId],
    );
    corruptedMatchId = invalid.rows[0]?.id ?? "";
    if (!corruptedMatchId) throw new Error("缺少用于非法比分验证的 R1 比赛。 ");
    await client.query("UPDATE matches SET score_a = 0, score_b = 0 WHERE id = $1", [corruptedMatchId]);
  } finally {
    client.release();
  }
  await expectSwissRuntimeFailure(() => database.transaction((tx) => finalizeMajorSwissRoundInTransaction(tx, {
    seasonId: fixture.seasonId, stageRunId, expectedRound: 1, actorId: "local-admin",
  })));
  const restoreClient = await pool.connect();
  try {
    await restoreClient.query("UPDATE matches SET score_a = 13, score_b = 11 WHERE id = $1", [corruptedMatchId]);
  } finally {
    restoreClient.release();
  }
  const correctionPlan = await database.transaction((tx) => planResultCorrectionInTx(tx, {
    matchId: corruptedMatchId,
    proposal: { scoreA: 16, scoreB: 13 },
  }));
  if (correctionPlan.winnerChanges || correctionPlan.blockedReasons.length > 0) {
    throw new Error("Golden rehearsal 的同胜者结果更正不应被错误阻断。 ");
  }
  const appliedCorrection = await database.transaction((tx) => applyResultCorrectionInTx(tx, {
    matchId: corruptedMatchId,
    proposal: { scoreA: 16, scoreB: 13 },
    actorId: "local-admin",
  }));
  const repeatedCorrection = await database.transaction((tx) => applyResultCorrectionInTx(tx, {
    matchId: corruptedMatchId,
    proposal: { scoreA: 16, scoreB: 13 },
    actorId: "local-admin-retry",
  }));
  if (appliedCorrection.alreadyApplied || repeatedCorrection.alreadyApplied !== true) {
    throw new Error("Golden rehearsal 的结果更正重试没有保持幂等。 ");
  }

  const concurrent = await Promise.all([
    database.transaction((tx) => finalizeMajorSwissRoundInTransaction(tx, { seasonId: fixture.seasonId, stageRunId, expectedRound: 1, actorId: "local-admin-a" })),
    database.transaction((tx) => finalizeMajorSwissRoundInTransaction(tx, { seasonId: fixture.seasonId, stageRunId, expectedRound: 1, actorId: "local-admin-b" })),
  ]);
  if (concurrent.filter((result) => !result.alreadyFinalized).length !== 1 || concurrent.some((result) => result.createdNextRound !== 8 && !result.alreadyFinalized)) {
    throw new Error("并发确认没有收敛到一次 R2 托管比赛生成。 ");
  }

  for (const round of [2, 3, 4, 5] as const) {
    await finishSwissRound(pool, stageRunId, round);
    const result = await database.transaction((tx) => finalizeMajorSwissRoundInTransaction(tx, {
      seasonId: fixture.seasonId, stageRunId, expectedRound: round, actorId: "local-admin",
    }));
    const expectedNextCount = ({ 2: 8, 3: 6, 4: 3, 5: 0 } as const)[round];
    if (result.createdNextRound !== expectedNextCount || result.stageComplete !== (round === 5)) {
      throw new Error(`第 ${round} 轮确认没有生成预期的下一轮或完成状态。`);
    }
  }

  const verifyClient = await pool.connect();
  try {
    const facts = await verifyClient.query<{ finalized_round: number; total_matches: string; r1: string; r2: string; r3: string; r4: string; r5: string; audits: string }>(`
      SELECT
        (SELECT finalized_round FROM major_stage_runs WHERE id = $1) AS finalized_round,
        (SELECT count(*) FROM matches WHERE major_stage_run_id = $1 AND ownership = 'major_stage') AS total_matches,
        (SELECT count(*) FROM matches WHERE major_stage_run_id = $1 AND ownership = 'major_stage' AND round = 1) AS r1,
        (SELECT count(*) FROM matches WHERE major_stage_run_id = $1 AND ownership = 'major_stage' AND round = 2) AS r2,
        (SELECT count(*) FROM matches WHERE major_stage_run_id = $1 AND ownership = 'major_stage' AND round = 3) AS r3,
        (SELECT count(*) FROM matches WHERE major_stage_run_id = $1 AND ownership = 'major_stage' AND round = 4) AS r4,
        (SELECT count(*) FROM matches WHERE major_stage_run_id = $1 AND ownership = 'major_stage' AND round = 5) AS r5,
        (SELECT count(*) FROM audit_logs WHERE target_id = $1::text AND action = 'major.swiss.finalize_round') AS audits
    `, [stageRunId]);
    const fact = facts.rows[0];
    if (!fact || fact.finalized_round !== 5 || fact.total_matches !== "33" || fact.r1 !== "8" || fact.r2 !== "8" || fact.r3 !== "8" || fact.r4 !== "6" || fact.r5 !== "3" || fact.audits !== "5") {
      throw new Error("Swiss 本地流程没有形成完整的 1→5 轮 canonical managed match 与确认审计事实。 ");
    }
  } finally {
    verifyClient.release();
  }
  return stageRunId;
}

async function completeSwissStage(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  seasonId: string,
  stageRunId: string,
): Promise<void> {
  for (const round of [1, 2, 3, 4, 5] as const) {
    await finishSwissRound(pool, stageRunId, round);
    const result = await database.transaction((tx) => finalizeMajorSwissRoundInTransaction(tx, {
      seasonId, stageRunId, expectedRound: round, actorId: "local-admin",
    }));
    if (result.stageRunId !== stageRunId || result.createdNextRound !== ({ 1: 8, 2: 8, 3: 6, 4: 3, 5: 0 } as const)[round]) {
      throw new Error("后续 Swiss StageRun 没有按其自身身份完整生成托管比赛。 ");
    }
  }
}

async function finishPlayoffRound(pool: Pool, stageRunId: string, round: "quarterfinal" | "semifinal" | "third_place" | "final"): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string; format: "bo3" | "bo5" }>(
      "SELECT id, format FROM matches WHERE major_stage_run_id = $1 AND entry_round = $2 ORDER BY managed_key",
      [stageRunId, round],
    );
    if (result.rows.length === 0) throw new Error(`${round} 没有可完成的托管淘汰赛比赛。 `);
    for (const [index, match] of result.rows.entries()) {
      const winsA = index % 2 === 0;
      await client.query("UPDATE matches SET score_a = $2, score_b = $3, status = 'finished', completed_at = now(), updated_at = now() WHERE id = $1", [
        match.id,
        match.format === "bo5" ? (winsA ? 3 : 2) : (winsA ? 2 : 1),
        match.format === "bo5" ? (winsA ? 2 : 3) : (winsA ? 1 : 2),
      ]);
    }
  } finally {
    client.release();
  }
}

async function exercisePlayoffRuntime(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  seasonId: string,
  stage3RunId: string,
): Promise<void> {
  const starts = await Promise.all([
    database.transaction((tx) => startMajorPlayoffInTransaction(tx, { seasonId, sourceStageRunId: stage3RunId, actorId: "local-admin-a", hasThirdPlaceMatch: true })),
    database.transaction((tx) => startMajorPlayoffInTransaction(tx, { seasonId, sourceStageRunId: stage3RunId, actorId: "local-admin-b", hasThirdPlaceMatch: true })),
  ]);
  if (starts.filter((result) => result.created).length !== 1 || new Set(starts.map((result) => result.stageRunId)).size !== 1 || starts.some((result) => result.matchCount !== 4)) {
    throw new Error("并发 Stage 3→Playoff 没有收敛到唯一的淘汰赛 StageRun。 ");
  }
  const playoffRunId = starts[0]!.stageRunId;
  for (const round of ["quarterfinal", "semifinal", "final"] as const) {
    await finishPlayoffRound(pool, playoffRunId, round);
    if (round === "final") {
      await finishPlayoffRound(pool, playoffRunId, "third_place");
    }
    const result = await database.transaction((tx) => finalizeMajorPlayoffRoundInTransaction(tx, {
      seasonId, stageRunId: playoffRunId, expectedRound: round, actorId: "local-admin",
    }));
    const expectedNext = ({ quarterfinal: 2, semifinal: 2, final: 0 } as const)[round];
    if (result.createdNextRound !== expectedNext || result.resultPendingConfirmation !== (round === "final")) {
      throw new Error(`${round} 没有生成预期的下一轮或待确认赛事结果。 `);
    }
  }
  const facts = await pool.query<{ matches: string; champion: string | null; status: string | null; has_three_four: boolean; groups: string }>(`
      SELECT
        (SELECT count(*) FROM matches WHERE major_stage_run_id = $1 AND ownership = 'major_stage') AS matches,
      (SELECT champion_entry_id::text FROM major_final_results WHERE playoff_stage_run_id = $1) AS champion,
      (SELECT status::text FROM major_final_results WHERE playoff_stage_run_id = $1) AS status,
      (SELECT EXISTS(SELECT 1 FROM major_final_results, jsonb_to_recordset(placement_groups) AS p("from" integer, "to" integer, "entryIds" jsonb) WHERE playoff_stage_run_id = $1 AND p."from" = 3 AND p."to" = 3)
        AND EXISTS(SELECT 1 FROM major_final_results, jsonb_to_recordset(placement_groups) AS p("from" integer, "to" integer, "entryIds" jsonb) WHERE playoff_stage_run_id = $1 AND p."from" = 4 AND p."to" = 4)) AS has_three_four,
      (SELECT jsonb_array_length(placement_groups)::text FROM major_final_results WHERE playoff_stage_run_id = $1) AS groups
  `, [playoffRunId]);
  const fact = facts.rows[0];
  if (!fact || fact.matches !== "8" || !fact.champion || fact.status !== "pending_confirmation" || !fact.has_three_four || fact.groups !== "14") {
    throw new Error("淘汰赛没有持久化八场比赛、冠军、3–4 名次区间与待确认正式结果。 ");
  }
  await exerciseFinalLifecycle(database, pool, seasonId, playoffRunId);
  const stageRuns = await pool.query<{ id: string; stage_key: string }>(
    "SELECT id, stage_key FROM major_stage_runs WHERE season_id = $1 AND stage_key IN ('stage1', 'stage2', 'stage3') ORDER BY stage_key",
    [seasonId],
  );
  const swissStages: Record<string, GoldenSwissEvidenceRow[]> = {};
  for (const stageRun of stageRuns.rows) swissStages[stageRun.stage_key] = await readSwissEvidence(pool, stageRun.id);
  const finalEvidence = await readFinalEvidence(pool, seasonId, playoffRunId);
  console.log(JSON.stringify({
    season: "local-golden-major-2026-08-retry",
    teams: 32,
    players: 160,
    swissStages,
    playoff: await readPlayoffEvidence(pool, playoffRunId),
    final: finalEvidence,
  }, null, 2));
}

async function exerciseFinalLifecycle(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  seasonId: string,
  playoffRunId: string,
): Promise<void> {
  const firstConfirmation = await database.transaction((tx) => confirmMajorFinalResultInTx(tx, { seasonId, actorId: "local-admin" }));
  const repeatedConfirmation = await database.transaction((tx) => confirmMajorFinalResultInTx(tx, { seasonId, actorId: "local-admin-retry" }));
  if (firstConfirmation.alreadyConfirmed || !repeatedConfirmation.alreadyConfirmed || firstConfirmation.resultId !== repeatedConfirmation.resultId) {
    throw new Error("Golden rehearsal 的最终结果确认重试没有收敛。 ");
  }

  const result = await pool.query<{ champion: string; placement_groups: Array<{ from: number; to: number; entryIds: string[] }> }>(
    "SELECT champion_entry_id::text AS champion, placement_groups FROM major_final_results WHERE season_id = $1 AND playoff_stage_run_id = $2",
    [seasonId, playoffRunId],
  );
  const finalResult = result.rows[0];
  const runnerUp = finalResult?.placement_groups.find((group) => group.from === 2 && group.to === 2)?.entryIds[0];
  if (!finalResult?.champion || !runnerUp) throw new Error("Golden rehearsal 缺少冠军或亚军正式名次。 ");

  const championHonor = await database.transaction((tx) => grantTournamentHonorInTx(tx, {
    seasonId, clientRequestId: deterministicUuid("honor/champion"), type: "champion", label: "Golden Champion",
    basis: "final_result", entryId: finalResult.champion, actorId: "local-admin",
  }));
  const repeatedHonor = await database.transaction((tx) => grantTournamentHonorInTx(tx, {
    seasonId, clientRequestId: deterministicUuid("honor/champion"), type: "champion", label: "Golden Champion",
    basis: "final_result", entryId: finalResult.champion, actorId: "local-admin-retry",
  }));
  const runnerUpHonor = await database.transaction((tx) => grantTournamentHonorInTx(tx, {
    seasonId, clientRequestId: deterministicUuid("honor/runner-up"), type: "runner_up", label: "Golden Runner-up",
    basis: "final_result", entryId: runnerUp, actorId: "local-admin",
  }));
  if (!championHonor.created || repeatedHonor.created || repeatedHonor.honorId !== championHonor.honorId || !runnerUpHonor.created) {
    throw new Error("Golden rehearsal 的荣誉授予重试或亚军荣誉事实异常。 ");
  }
  await database.transaction((tx) => revokeTournamentHonorInTx(tx, { honorId: championHonor.honorId, actorId: "local-admin", reason: "Golden explicit revoke" }));
  const repeatedRevoke = await database.transaction((tx) => revokeTournamentHonorInTx(tx, { honorId: championHonor.honorId, actorId: "local-admin-retry", reason: "Golden explicit revoke" }));
  if (!repeatedRevoke.alreadyRevoked) throw new Error("Golden rehearsal 的荣誉撤销重试没有幂等。 ");

  const adjudication = await database.transaction((tx) => createPostEventAdjudicationInTx(tx, {
    seasonId, clientRequestId: deterministicUuid("adjudication/placement"), kind: "placement_statement", target: "season",
    impacts: ["official_placements"], reason: "Golden explicit placement audit", publicExplanation: "Golden placement statement",
    internalEvidence: "local-only golden evidence", actorId: "local-admin",
  }));
  const repeatedAdjudication = await database.transaction((tx) => createPostEventAdjudicationInTx(tx, {
    seasonId, clientRequestId: deterministicUuid("adjudication/placement"), kind: "placement_statement", target: "season",
    impacts: ["official_placements"], reason: "Golden explicit placement audit", publicExplanation: "Golden placement statement",
    internalEvidence: "local-only golden evidence", actorId: "local-admin-retry",
  }));
  if (!adjudication.created || repeatedAdjudication.created || repeatedAdjudication.adjudicationId !== adjudication.adjudicationId) {
    throw new Error("Golden rehearsal 的赛后裁决重试没有幂等。 ");
  }

  const firstArchive = await database.transaction((tx) => archiveTournamentInTx(tx, { seasonId, actorId: "local-admin" }));
  const repeatedArchive = await database.transaction((tx) => archiveTournamentInTx(tx, { seasonId, actorId: "local-admin-retry" }));
  if (firstArchive.alreadyArchived || !repeatedArchive.alreadyArchived) throw new Error("Golden rehearsal 的归档重试没有幂等。 ");

  const finalMatch = await pool.query<{ id: string }>("SELECT id FROM matches WHERE major_stage_run_id = $1 AND entry_round = 'final'", [playoffRunId]);
  const finalMatchId = finalMatch.rows[0]?.id;
  if (!finalMatchId) throw new Error("Golden rehearsal 缺少决赛比赛事实。 ");
  try {
    await database.transaction((tx) => lockMatchInTx(tx, finalMatchId));
    throw new Error("归档后普通赛事变更错误地被允许。 ");
  } catch (error) {
    if (error instanceof Error && error.message === "归档后普通赛事变更错误地被允许。 ") throw error;
    if (!(error instanceof AppError) || error.code !== ErrorCode.VALIDATION_FAILED) throw error;
  }
  const postArchiveAdjudication = await database.transaction((tx) => createPostEventAdjudicationInTx(tx, {
    seasonId, clientRequestId: deterministicUuid("adjudication/post-archive"), kind: "result_statement", target: "season",
    impacts: ["final_result"], reason: "Golden post-archive verification", publicExplanation: "Golden post-archive statement", actorId: "local-admin",
  }));
  if (!postArchiveAdjudication.created) throw new Error("归档后专用裁决没有允许写入。 ");

  const finalState = await pool.query<{ status: string; champion_state: string; runner_up_state: string; valid_champion: string }>(`
    SELECT
      (SELECT status FROM seasons WHERE id = $1) AS status,
      (SELECT state FROM tournament_honors WHERE id = $2) AS champion_state,
      (SELECT state FROM tournament_honors WHERE id = $3) AS runner_up_state,
      (SELECT count(*)::text FROM tournament_honors WHERE season_id = $1 AND honor_key = 'champion' AND state = 'valid') AS valid_champion
  `, [seasonId, championHonor.honorId, runnerUpHonor.honorId]);
  const state = finalState.rows[0];
  if (!state || state.status !== "archived" || state.champion_state !== "revoked" || state.runner_up_state !== "valid" || state.valid_champion !== "0") {
    throw new Error("Golden rehearsal 的最终结果、荣誉与归档状态不一致。 ");
  }
  console.log("Golden Major full rehearsal passed: deterministic 32 teams, 160 profiled players, Stage 1–3 R1–R5, enabled BO3 third-place, BO5 final, confirmed result, explicit honors/adjudication, idempotent retries, archive guard, and post-archive adjudication.");
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  const fixtures: MajorFixture[] = [];
  try {
    await cleanupStaleMajorStartFixtures(pool);
    const ready = await prepareReadyMajor(pool, "retry");
    fixtures.push(ready);
    const retryResults = await Promise.all([
      database.transaction((tx) => startMajorInTransaction(tx, { seasonId: ready.seasonId, actorId: "local-admin-a" })),
      database.transaction((tx) => startMajorInTransaction(tx, { seasonId: ready.seasonId, actorId: "local-admin-b" })),
    ]);
    if (retryResults.filter((result) => result.created).length !== 1 || retryResults.some((result) => result.matchCount !== 8)) {
      throw new Error("并发重试没有收敛到一个 Stage 1 运行和 8 场比赛。");
    }

    const client = await pool.connect();
    try {
      const started = await client.query<{ status: string; runs: string; entrants: string; matches: string; audits: string; seeds_locked: boolean; rule_snapshot: { stage?: { key?: string }; openingPairings?: unknown[]; affiliationRules?: Array<{ institutionCode?: string; minRosterMembers?: number; minStartingMembers?: number }> } }>(`
        SELECT
          (SELECT status FROM seasons WHERE id = $1) AS status,
          (SELECT count(*) FROM major_stage_runs WHERE season_id = $1) AS runs,
          (SELECT count(*) FROM major_stage_entrants e INNER JOIN major_stage_runs r ON r.id = e.stage_run_id WHERE r.season_id = $1) AS entrants,
          (SELECT count(*) FROM matches WHERE season_id = $1 AND ownership = 'major_stage') AS matches,
          (SELECT count(*) FROM audit_logs WHERE season_id = $1 AND action = 'major.start') AS audits,
          (SELECT seeds_locked_at IS NOT NULL FROM major_prestart_states WHERE season_id = $1) AS seeds_locked,
          (SELECT rule_snapshot FROM major_stage_runs WHERE season_id = $1) AS rule_snapshot
      `, [ready.seasonId]);
      const facts = started.rows[0];
      const frozenNjuRule = facts?.rule_snapshot?.affiliationRules?.find((rule) => rule.institutionCode === "4132010284");
      if (facts?.status !== "playing" || facts.runs !== "1" || facts.entrants !== "16" || facts.matches !== "8" || facts.audits !== "1" || !facts.seeds_locked || facts.rule_snapshot?.stage?.key !== "stage1" || facts.rule_snapshot?.openingPairings?.length !== 8 || frozenNjuRule?.minRosterMembers !== 3 || frozenNjuRule.minStartingMembers !== 3) {
        throw new Error("正式开赛没有完整固化状态、入口、比赛或审计事实。");
      }
      const firstMatch = await client.query<{ major_stage_run_id: string; entry_a_id: string; entry_b_id: string; stage: string; format: string }>(
        "SELECT major_stage_run_id, entry_a_id, entry_b_id, stage, format FROM matches WHERE season_id = $1 AND ownership = 'major_stage' ORDER BY managed_key LIMIT 1",
        [ready.seasonId],
      );
      const match = firstMatch.rows[0];
      if (!match) throw new Error("未找到已生成的 managed match。");
      await client.query("BEGIN");
      await expectPgError(client, () => client.query(
        `INSERT INTO matches (season_id, entry_a_id, entry_b_id, stage, round, format, ownership, major_stage_run_id, managed_key)
         VALUES ($1, $2, $3, $4, 1, $5, 'major_stage', $6, 'r1-1')`,
        [ready.seasonId, match.entry_a_id, match.entry_b_id, match.stage, match.format, match.major_stage_run_id],
      ), "23505");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const stage1RunId = await exerciseSwissRuntime(database, pool, ready);
    const stage2Transitions = await Promise.all([
      database.transaction((tx) => transitionMajorSwissStageInTransaction(tx, {
        seasonId: ready.seasonId, sourceStageRunId: stage1RunId, actorId: "local-admin-a",
      })),
      database.transaction((tx) => transitionMajorSwissStageInTransaction(tx, {
        seasonId: ready.seasonId, sourceStageRunId: stage1RunId, actorId: "local-admin-b",
      })),
    ]);
    if (stage2Transitions.filter((result) => result.created).length !== 1 || new Set(stage2Transitions.map((result) => result.stageRunId)).size !== 1 || stage2Transitions.some((result) => result.stageKey !== "stage2" || result.matchCount !== 8)) {
      throw new Error("并发 Stage 1→Stage 2 切换没有收敛到唯一的 StageRun 和首轮比赛。 ");
    }
    const stage2RunId = stage2Transitions[0]!.stageRunId;
    await completeSwissStage(database, pool, ready.seasonId, stage2RunId);
    const stage3Transition = await database.transaction((tx) => transitionMajorSwissStageInTransaction(tx, {
      seasonId: ready.seasonId, sourceStageRunId: stage2RunId, actorId: "local-admin",
    }));
    if (!stage3Transition.created || stage3Transition.stageKey !== "stage3" || stage3Transition.matchCount !== 8) {
      throw new Error("Stage 2→Stage 3 没有创建完整的下一 StageRun。 ");
    }
    await completeSwissStage(database, pool, ready.seasonId, stage3Transition.stageRunId);
    const stageTransitionFacts = await pool.query<{ runs: string; entrants: string; matches: string; complete_runs: string; transitions: string }>(`
      SELECT
        (SELECT count(*) FROM major_stage_runs WHERE season_id = $1) AS runs,
        (SELECT count(*) FROM major_stage_entrants e INNER JOIN major_stage_runs r ON r.id = e.stage_run_id WHERE r.season_id = $1) AS entrants,
        (SELECT count(*) FROM matches WHERE season_id = $1 AND ownership = 'major_stage') AS matches,
        (SELECT count(*) FROM major_stage_runs WHERE season_id = $1 AND finalized_round = 5) AS complete_runs,
        (SELECT count(*) FROM audit_logs WHERE season_id = $1 AND action = 'major.stage.transition') AS transitions
    `, [ready.seasonId]);
    const transitionFacts = stageTransitionFacts.rows[0];
    if (!transitionFacts || transitionFacts.runs !== "3" || transitionFacts.entrants !== "48" || transitionFacts.matches !== "99" || transitionFacts.complete_runs !== "3" || transitionFacts.transitions !== "2") {
      throw new Error("三阶段连续运行没有形成逐 StageRun 隔离的 canonical entrants、比赛和切换审计事实。 ");
    }
    await exercisePlayoffRuntime(database, pool, ready.seasonId, stage3Transition.stageRunId);

    const rollback = await prepareReadyMajor(pool, "rollback");
    fixtures.push(rollback);
    const triggerClient = await pool.connect();
    try {
      await triggerClient.query(`
        CREATE FUNCTION fail_local_major_start_match() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'local major start rollback sentinel'; END;
        $$;
        CREATE TRIGGER fail_local_major_start_match BEFORE INSERT ON matches
        FOR EACH ROW WHEN (NEW.ownership = 'major_stage') EXECUTE FUNCTION fail_local_major_start_match();
      `);
      await database.transaction((tx) => startMajorInTransaction(tx, { seasonId: rollback.seasonId, actorId: "local-admin" }))
        .then(() => { throw new Error("预期启动事务因 sentinel 回滚，但操作成功。"); })
        .catch((error) => {
          if (!(error instanceof Error) || !error.message.includes("rollback sentinel")) throw error;
        });
      const rolledBack = await triggerClient.query<{ status: string; runs: string; entrants: string; matches: string; seeds_locked: boolean }>(`
        SELECT
          (SELECT status FROM seasons WHERE id = $1) AS status,
          (SELECT count(*) FROM major_stage_runs WHERE season_id = $1) AS runs,
          (SELECT count(*) FROM major_stage_entrants e INNER JOIN major_stage_runs r ON r.id = e.stage_run_id WHERE r.season_id = $1) AS entrants,
          (SELECT count(*) FROM matches WHERE season_id = $1 AND ownership = 'major_stage') AS matches,
          (SELECT seeds_locked_at IS NOT NULL FROM major_prestart_states WHERE season_id = $1) AS seeds_locked
      `, [rollback.seasonId]);
      const facts = rolledBack.rows[0];
      if (facts?.status !== "registration" || facts.runs !== "0" || facts.entrants !== "0" || facts.matches !== "0" || facts.seeds_locked) {
        throw new Error("Stage 1 创建失败后存在部分提交，违反原子回滚要求。");
      }
    } finally {
      await triggerClient.query("DROP TRIGGER IF EXISTS fail_local_major_start_match ON matches");
      await triggerClient.query("DROP FUNCTION IF EXISTS fail_local_major_start_match()");
      triggerClient.release();
    }
    console.log("Major local integration passed: start retry, 32-team lock, StageRun-scoped entrants and managed matches, three consecutive Swiss stages, persistent playoff through champion, pending final result, missing/illegal-result rejection, concurrent confirmation and transition, and forced rollback.");
  } finally {
    for (const fixture of fixtures) await cleanupMajorFixture(pool, fixture);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
