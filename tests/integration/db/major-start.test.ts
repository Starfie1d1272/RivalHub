import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "../../../src/db/client";
import * as schema from "../../../src/db/schema";
import { requestCompetitionEntryRosterChangeInTx } from "../../../src/lib/competition-entries/roster-change";
import { confirmCompetitionEntryParticipationInTx } from "../../../src/lib/competition-entries/commands";
import { saveMajorPrestartRosterInTx } from "../../../src/lib/major/prestart-roster";
import { startMajorInTransaction } from "../../../src/lib/major/start";
import { finalizeMajorSwissRoundInTransaction } from "../../../src/lib/major/swiss-runtime";
import { transitionMajorSwissStageInTransaction } from "../../../src/lib/major/stage-transition";
import { finalizeMajorPlayoffRoundInTransaction, startMajorPlayoffInTransaction } from "../../../src/lib/major/playoff-runtime";
import { projectMajorSwissStage, type MajorSwissMatchFact } from "../../../src/lib/major/swiss";
import { AppError, ErrorCode } from "../../../src/lib/errors";
import { createMajorDefaultCapabilities, type CompetitiveProfileConfig } from "../../../src/types/season";
import { createPerfectWorldRankOrder } from "../../../src/lib/config/perfect-world";
import {
  applyResultCorrectionInTx,
  planResultCorrectionInTx,
} from "../../../src/lib/match-corrections/service";
import {
  archiveTournamentInTx,
  confirmMajorFinalResultInTx,
  createPostEventAdjudicationInTx,
  grantTournamentHonorInTx,
  revokeTournamentHonorInTx,
} from "../../../src/lib/postevent/service";
import { lockMatchInTx } from "../../../src/lib/match-rosters/service";
import { deleteCompetitivePlatformCatalog, seedCompetitivePlatformCatalog } from "./harness/competitive-catalog-fixtures";
import { capturePostgresError, localDatabaseUrl } from "./harness/database";

const GOLDEN_PROFILE: CompetitiveProfileConfig = {
  // 专属 fixture 平台 key：不与 seed 内置 perfect_world 目录争夺 per-platform
  // unique current 赛季，保证套件在 reset/bootstrap 后仍然 hermetic。
  platform: "golden-perfect-world",
  currentSeasonKey: "golden-major-2026-current",
  previousSeasonKey: "golden-major-2026-previous",
  rankOrder: createPerfectWorldRankOrder(),
};

function deterministicUuid(scope: string): string {
  const hex = createHash("sha256").update(`rivalhub-golden-major:${scope}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(parseInt(hex.slice(16, 18), 16) & 0x3f | 0x80).toString(16).padStart(2, "0")}${hex.slice(18, 20)}-${hex.slice(20)}`;
}

const databaseUrl = localDatabaseUrl();

async function runConcurrencyTransaction<T>(
  database: ReturnType<typeof drizzle<typeof schema>>,
  work: (tx: TxDb) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
    return work(tx);
  });
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

function postgresErrorDetail(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const candidate = error as { message?: unknown; detail?: unknown; cause?: unknown };
  const direct = [candidate.message, candidate.detail].filter((value): value is string => typeof value === "string");
  if (candidate.cause) return [...direct, postgresErrorDetail(candidate.cause)].filter(Boolean).join(" | ");
  return direct.join(" | ");
}

function assertNoConcurrencyTimeout(
  results: readonly PromiseSettledResult<unknown>[],
  label: string,
): void {
  for (const result of results) {
    if (result.status !== "rejected") continue;
    const code = postgresErrorCode(result.reason);
    if (code === "40P01" || code === "55P03" || code === "57014") {
      throw new Error(`${label} 出现 PostgreSQL 并发错误 ${code}，不得把死锁或 timeout 当作预期结果：${postgresErrorDetail(result.reason)}`);
    }
  }
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

async function prepareReadyMajor(
  pool: Pool,
  label: string,
  options: { editablePrestart?: boolean } = {},
): Promise<MajorFixture> {
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
    await seedCompetitivePlatformCatalog(client, GOLDEN_PROFILE.platform, [
      { seasonKey: GOLDEN_PROFILE.previousSeasonKey, label: "Golden previous", sortOrder: 0, isCurrent: false },
      { seasonKey: GOLDEN_PROFILE.currentSeasonKey, label: "Golden current", sortOrder: 1, isCurrent: true },
    ], GOLDEN_PROFILE.rankOrder);
    await client.query(
      `INSERT INTO seasons (
        id, slug, name, kind, competition_template, status, registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions, registration_opens_at, registration_opened_at
      ) VALUES ($1, $2, 'Local Major Start', 'Major', 'major', 'registration', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[], now(), now())`,
      [
        seasonId, `local-golden-major-2026-08-${label}`,
        capabilities.registrationMode, capabilities.hasCaptainVoting, capabilities.hasDraft,
        JSON.stringify(capabilities.stagePlan), JSON.stringify(capabilities.registrationConfig),
        JSON.stringify(capabilities.teamRegistrationConfig), JSON.stringify(capabilities.affiliationRules),
        capabilities.minTeamSize, capabilities.maxTeamSize, capabilities.starterCount, capabilities.positions,
      ],
    );
    await client.query(
      `INSERT INTO users (id, email, email_verified_at, display_name, steam_name, perfect_name, steam64, steam_profile_url, qq, student_id)
       SELECT value::uuid,
              'golden-major-' || $2 || '-' || ordinal || '@local.test',
              now(),
              'Golden ' || $2 || ' Player ' || ordinal,
              'Golden ' || $2 || ' Steam ' || ordinal,
              'Golden ' || $2 || ' Perfect Name ' || ordinal,
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
        `INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, approved_roster_revision_id, registration_status, perfect_team_id)
         VALUES ($1, $2, 'event_native', $3, $4, $5, $5, 'approved', $6)`,
        [entryId, seasonId, `Golden Team ${index + 1}`, memberUsers[0], revisionIds[index], `golden-team-${index + 1}`],
      );
      await client.query(
        "INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-admin')",
        [entryId, memberUsers[0]],
      );
      for (let offset = 0; offset < 5; offset += 1) {
        await client.query(
          `INSERT INTO competition_entry_participants (id, entry_id, user_id, status, confirmed_at, invited_by_user_id)
           VALUES ($1, $2, $3, 'confirmed', now(), $4)`,
          [deterministicUuid(`${label}/participant/${index * 5 + offset + 1}`), entryId, memberUsers[offset], memberUsers[0]],
        );
      }
      await client.query(
        `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
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
          `INSERT INTO event_roster_members (id, event_roster_id, participant_id, user_id, education_verification_id, is_primary_starter)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [deterministicUuid(`${label}/event-roster-member/${index * 5 + offset + 1}`), eventRosterIds[index], deterministicUuid(`${label}/participant/${index * 5 + offset + 1}`), memberUsers[offset], verificationId, offset === 0],
        );
      }
      if (!options.editablePrestart) {
        await client.query(`UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-admin' WHERE id = $1`, [eventRosterIds[index]]);
        await client.query(`UPDATE event_rosters SET status = 'frozen', confirmed_at = now(), confirmed_by = 'local-admin', frozen_at = now(), frozen_by = 'local-admin' WHERE id = $1`, [eventRosterIds[index]]);
      }
    }
    await client.query(
      `INSERT INTO major_prestart_states (season_id, entrants_locked_at, entrants_locked_by, seeds_confirmed_at, seeds_confirmed_by)
       VALUES ($1, ${options.editablePrestart ? "NULL, NULL" : "now(), 'local-admin'"}, now(), 'local-admin')`,
      [seasonId],
    );
    for (let index = 0; index < 32; index += 1) {
      const entrant = await client.query<{ id: string }>(
        `INSERT INTO major_tournament_entrants (id, season_id, competition_entry_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [deterministicUuid(`${label}/entrant/${index + 1}`), seasonId, entryIds[index]],
      );
      const entrantId = entrant.rows[0]?.id;
      if (!entrantId) throw new Error("正式参赛队创建失败。");
      await client.query(
        `INSERT INTO major_tournament_seeds (id, season_id, tournament_entrant_id, seed) VALUES ($1, $2, $3, $4)`,
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
    await client.query("DELETE FROM major_tournament_entrants WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.seasonId]);
    // Frozen-roster immutability and append-only provenance are intentional in
    // normal operation; local teardown bypasses row triggers for its own rows.
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(`DELETE FROM event_roster_members WHERE event_roster_id IN (
      SELECT id FROM event_rosters WHERE entry_id IN (
        SELECT id FROM competition_entries WHERE competition_id = $1
      )
    )`, [fixture.seasonId]);
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
    await client.query(`DELETE FROM competition_entry_representative_changes WHERE entry_id IN (
      SELECT id FROM competition_entries WHERE competition_id = $1
    )`, [fixture.seasonId]);
    await client.query("DELETE FROM competition_entries WHERE competition_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [fixture.userIds]);
    await client.query("DELETE FROM competitive_rank_facts WHERE user_id = ANY($1::uuid[])", [fixture.userIds]);
    await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [fixture.userIds]);
    await deleteCompetitivePlatformCatalog(client, GOLDEN_PROFILE.platform);
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
    SELECT entrant.competition_entry_id, en.name AS entry_name, e.stage_seed, seed.seed AS tournament_seed
    FROM major_stage_entrants e
    INNER JOIN major_tournament_entrants entrant ON entrant.id = e.tournament_entrant_id
    INNER JOIN major_tournament_seeds seed ON seed.tournament_entrant_id = entrant.id AND seed.season_id = e.season_id
    INNER JOIN competition_entries en ON en.id = entrant.competition_entry_id
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

async function expectMajorStartFailure(
  database: ReturnType<typeof drizzle<typeof schema>>,
  seasonId: string,
  keyword: string,
): Promise<void> {
  try {
    await database.transaction((tx) => startMajorInTransaction(tx, { seasonId, actorId: "local-admin" }));
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.VALIDATION_FAILED && error.message.includes(keyword)) return;
    throw error;
  }
  throw new Error(`预期 startMajorInTransaction 因「${keyword}」被拒绝，但操作成功。`);
}

/** 开赛被拒绝后不得留下任何部分开赛事实（season 状态、StageRun、managed match、seedsLockedAt）。 */
async function assertNoStartFacts(pool: Pool, seasonId: string): Promise<void> {
  const client = await pool.connect();
  try {
    const facts = await client.query<{ status: string; runs: string; matches: string; seeds_locked: boolean }>(`
      SELECT
        (SELECT status FROM seasons WHERE id = $1) AS status,
        (SELECT count(*) FROM major_stage_runs WHERE season_id = $1) AS runs,
        (SELECT count(*) FROM matches WHERE season_id = $1 AND ownership = 'major_stage') AS matches,
        (SELECT seeds_locked_at IS NOT NULL FROM major_prestart_states WHERE season_id = $1) AS seeds_locked
    `, [seasonId]);
    const fact = facts.rows[0];
    if (!fact || fact.status !== "registration" || fact.runs !== "0" || fact.matches !== "0" || fact.seeds_locked) {
      throw new Error("开赛被拒绝后仍留下了部分开赛事实。");
    }
  } finally {
    client.release();
  }
}

/**
 * start vs Entry roster-remediation：两个 production transaction owner 必须
 * 在 canonical Entry → eventRoster → prestart entrant 顺序下收敛，不得
 * 出现 40P01、lock timeout 或半成品开赛事实。
 */
async function exerciseStartVsRosterChangeConcurrency(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  fixtures: MajorFixture[],
): Promise<void> {
  const fixture = await prepareReadyMajor(pool, "start-remediation-concurrency");
  fixtures.push(fixture);
  const entryId = deterministicUuid("start-remediation-concurrency/entry/1");
  const representativeUserId = fixture.userIds[0]!;
  const results = await Promise.allSettled([
    runConcurrencyTransaction(database, (tx) => startMajorInTransaction(tx, { seasonId: fixture.seasonId, actorId: "local-start" })),
    runConcurrencyTransaction(database, (tx) => requestCompetitionEntryRosterChangeInTx(tx, {
      entryId,
      representativeUserId,
      actorId: representativeUserId,
    })),
  ]);
  assertNoConcurrencyTimeout(results, "start vs roster change");

  const startResult = results[0];
  const rosterResult = results[1];
  let startWon: boolean;
  if (startResult?.status === "fulfilled" && rosterResult?.status === "rejected") {
    startWon = true;
    if (!startResult.value.created || startResult.value.matchCount !== 8) {
      throw new Error("start vs roster change 的 start 胜出路径未形成完整的 Stage 1。 ");
    }
    if (!(rosterResult.reason instanceof AppError) || rosterResult.reason.code !== ErrorCode.REGISTRATION_INVALID_TRANSITION) {
      throw new Error("start 胜出后，event roster 已冻结时的 roster change 应得到明确业务拒绝。 ");
    }
  } else if (startResult?.status === "rejected" && rosterResult?.status === "fulfilled") {
    startWon = false;
    if (!(startResult?.reason instanceof AppError) || startResult.reason.code !== ErrorCode.VALIDATION_FAILED || !startResult.reason.message.includes("名单补正")) {
      throw new Error("roster change 胜出后，start 应得到明确的 coherence/validation 拒绝。 ");
    }
  } else {
    throw new Error("start vs roster change 没有收敛为一个明确的胜者。 ");
  }

  const facts = await pool.query<{ status: string; runs: string; matches: string; seedsLocked: boolean; entryStatus: string; rosterStatus: string; confirmedAt: Date | null }>(`
    SELECT
      (SELECT status FROM seasons WHERE id = $1) AS status,
      (SELECT count(*) FROM major_stage_runs WHERE season_id = $1) AS runs,
      (SELECT count(*) FROM matches WHERE season_id = $1 AND ownership = 'major_stage') AS matches,
      (SELECT seeds_locked_at IS NOT NULL FROM major_prestart_states WHERE season_id = $1) AS "seedsLocked",
      (SELECT registration_status FROM competition_entries WHERE id = $2) AS "entryStatus",
      (SELECT status FROM event_rosters WHERE entry_id = $2) AS "rosterStatus"
  `, [fixture.seasonId, entryId]);
  const fact = facts.rows[0];
  if (!fact) throw new Error("start vs roster change 缺少最终事实。 ");
  if (startWon) {
    if (fact.status !== "playing" || fact.runs !== "1" || fact.matches !== "8" || !fact.seedsLocked || fact.entryStatus !== "approved" || fact.rosterStatus !== "frozen") {
      throw new Error("start 胜出后存在部分开赛、Entry 或冻结名单事实不一致。 ");
    }
  } else if (fact.status !== "registration" || fact.runs !== "0" || fact.matches !== "0" || fact.seedsLocked || fact.entryStatus !== "changes_requested" || fact.rosterStatus === "frozen") {
    throw new Error("roster change 胜出后仍存在部分开赛或 stale frozen roster 事实。 ");
  }
}

/**
 * save prestart roster vs Entry roster-remediation：save owner 的 relaxed
 * resync 只能在 Entry → eventRoster 后读取 approved revision，最终仍需
 * strict coherence；两个真实事务必须无死锁并留下可解释的最终状态。
 */
async function exerciseSaveVsRosterChangeConcurrency(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  fixtures: MajorFixture[],
): Promise<void> {
  const fixture = await prepareReadyMajor(pool, "save-remediation-concurrency", { editablePrestart: true });
  fixtures.push(fixture);
  const entryId = deterministicUuid("save-remediation-concurrency/entry/1");
  const entrantId = deterministicUuid("save-remediation-concurrency/entrant/1");
  const userIds = fixture.userIds.slice(0, 5);
  const results = await Promise.allSettled([
    runConcurrencyTransaction(database, (tx) => saveMajorPrestartRosterInTx(tx, {
      seasonId: fixture.seasonId,
      entrantId,
      userIds,
      actorId: "local-save",
    })),
    runConcurrencyTransaction(database, (tx) => requestCompetitionEntryRosterChangeInTx(tx, {
      entryId,
      representativeUserId: userIds[0]!,
      actorId: userIds[0]!,
    })),
  ]);
  assertNoConcurrencyTimeout(results, "save vs roster change");

  const requestResult = results[1];
  if (requestResult?.status !== "fulfilled") {
    throw requestResult?.reason instanceof Error
      ? requestResult.reason
      : new Error(`save vs roster change 的 roster change 失败：${String(requestResult?.reason)}`);
  }
  const saveResult = results[0];
  if (saveResult?.status === "rejected" && (!(saveResult.reason instanceof AppError) || saveResult.reason.code !== ErrorCode.VALIDATION_FAILED || !saveResult.reason.message.includes("名单补正"))) {
    throw saveResult.reason instanceof Error
      ? saveResult.reason
      : new Error(`save vs roster change 的 save 失败：${String(saveResult.reason)}`);
  }
  if (saveResult?.status !== "fulfilled" && saveResult?.status !== "rejected") {
    throw new Error("save vs roster change 缺少 save transaction 结果。 ");
  }

  const facts = await pool.query<{ entryStatus: string; rosterStatus: string; sourceRevisionId: string | null; approvedRevisionId: string | null; confirmedAt: Date | null }>(`
    SELECT
      e.registration_status AS "entryStatus",
      r.status AS "rosterStatus",
      r.source_roster_revision_id::text AS "sourceRevisionId",
      approved.id::text AS "approvedRevisionId"
    FROM competition_entries e
    INNER JOIN event_rosters r ON r.entry_id = e.id
    LEFT JOIN competition_entry_roster_revisions approved
      ON approved.id = e.approved_roster_revision_id AND approved.entry_id = e.id
    WHERE e.id = $1
  `, [entryId]);
  const fact = facts.rows[0];
  if (!fact || fact.entryStatus !== "changes_requested" || fact.rosterStatus === "frozen" || fact.sourceRevisionId !== fact.approvedRevisionId) {
    throw new Error("save vs roster change 后 Entry、event roster、approved revision 与 confirmation 不一致。 ");
  }
}

/** A self-service roster change cannot retain the generic changes_requested
 * remediation exception after its roster-change deadline passes. */
async function exerciseSelfRosterChangeDeadline(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  fixtures: MajorFixture[],
): Promise<void> {
  const label = "self-roster-deadline";
  const fixture = await prepareReadyMajor(pool, label, { editablePrestart: true });
  fixtures.push(fixture);
  const entryId = deterministicUuid(`${label}/entry/1`);
  const representativeUserId = fixture.userIds[0]!;
  await pool.query("UPDATE seasons SET registration_opened_at = NULL WHERE id = $1", [fixture.seasonId]);
  await expect(database.transaction((tx) => requestCompetitionEntryRosterChangeInTx(tx, { entryId, representativeUserId, actorId: representativeUserId })))
    .rejects.toMatchObject({ code: ErrorCode.REGISTRATION_CLOSED });
  await pool.query("UPDATE seasons SET registration_opened_at = now() WHERE id = $1", [fixture.seasonId]);
  await database.transaction((tx) => requestCompetitionEntryRosterChangeInTx(tx, { entryId, representativeUserId, actorId: representativeUserId }));
  const origin = await pool.query<{ origin: string }>("SELECT r.origin::text AS origin FROM competition_entries e INNER JOIN competition_entry_roster_revisions r ON r.id = e.current_roster_revision_id WHERE e.id = $1", [entryId]);
  expect(origin.rows[0]?.origin).toBe("self_roster_change");
  await pool.query("UPDATE seasons SET roster_change_closes_at = now() - interval '1 second' WHERE id = $1", [fixture.seasonId]);
  await expect(database.transaction((tx) => confirmCompetitionEntryParticipationInTx(tx, { entryId, userId: representativeUserId, actorId: representativeUserId })))
    .rejects.toMatchObject({ code: ErrorCode.REGISTRATION_CLOSED });
}

/**
 * Scenario A/B：已批准 Entry 重新进入补正（或换了新批准版本但 event roster
 * 未重同步）时，正式开赛必须 fail closed；显式重同步后才能开赛。
 */
async function exerciseStaleRosterCoherence(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  fixtures: MajorFixture[],
): Promise<void> {
  const fixture = await prepareReadyMajor(pool, "coherence", { editablePrestart: true });
  fixtures.push(fixture);
  const entryId = deterministicUuid("coherence/entry/1");
  const revisionId = deterministicUuid("coherence/revision/1");
  const eventRosterId = deterministicUuid("coherence/event-roster/1");
  const nextRevisionId = deterministicUuid("coherence/revision-next/1");

  // Keep one roster editable for the stale-sync scenario while making the
  // other 31 entrants ready, so the final resync still exercises a complete
  // Major start rather than failing on unrelated fixture readiness.
  await pool.query(
     `UPDATE event_rosters
     SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-admin'
     WHERE entry_id <> $1
       AND entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $2)`,
    [entryId, fixture.seasonId],
  );
  await pool.query(
    `UPDATE event_rosters
     SET status = 'frozen', frozen_at = now(), frozen_by = 'local-admin'
     WHERE entry_id <> $1
       AND entry_id IN (SELECT id FROM competition_entries WHERE competition_id = $2)`,
    [entryId, fixture.seasonId],
  );
  await pool.query(
    "UPDATE major_prestart_states SET entrants_locked_at = now(), entrants_locked_by = 'local-admin' WHERE season_id = $1",
    [fixture.seasonId],
  );

  // Scenario A：approved Entry → prestart → roster change → start blocked。
  await pool.query(
    "UPDATE competition_entries SET registration_status = 'changes_requested', review_reason = 'local coherence drill' WHERE id = $1",
    [entryId],
  );
  await expectMajorStartFailure(database, fixture.seasonId, "名单补正");
  await assertNoStartFacts(pool, fixture.seasonId);

  // Case 2：补正完成并获得 approved revision 2，但 event roster 仍指向 revision 1 → 仍被拒绝。
  await pool.query("UPDATE competition_entries SET registration_status = 'approved' WHERE id = $1", [entryId]);
  const revisionTransition = await pool.connect();
  try {
    await revisionTransition.query("BEGIN");
    await revisionTransition.query(
      `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
       VALUES ($1, $2, 2, 'approved', 'local-admin', now())`,
      [nextRevisionId, entryId],
    );
    await revisionTransition.query("UPDATE competition_entries SET current_roster_revision_id = $2, approved_roster_revision_id = $2 WHERE id = $1", [entryId, nextRevisionId]);
    await revisionTransition.query("COMMIT");
  } catch (error) {
    await revisionTransition.query("ROLLBACK");
    throw error;
  } finally {
    revisionTransition.release();
  }
  await expectMajorStartFailure(database, fixture.seasonId, "重新同步最终名单");
  await assertNoStartFacts(pool, fixture.seasonId);

  // Case 3 / Scenario B：显式重同步 event roster 到 revision 2 → 开赛成功，
  // 且冻结的赛事名单事实消费重同步后的 revision。
  const revisionMembers = await pool.query<{ participant_id: string; user_id: string; is_primary_starter: boolean }>(
    "SELECT participant_id, user_id, is_primary_starter FROM competition_entry_roster_members WHERE revision_id = $1 ORDER BY user_id",
    [revisionId],
  );
  if (revisionMembers.rows.length !== 5) throw new Error("coherence fixture 的 revision 1 成员数异常。 ");
  await pool.query(
    `INSERT INTO competition_entry_roster_members (revision_id, participant_id, user_id, is_primary_starter)
     VALUES ${revisionMembers.rows.map((_, index) => `($1, $${index * 3 + 2}, $${index * 3 + 3}, $${index * 3 + 4})`).join(", ")}`,
    [nextRevisionId, ...revisionMembers.rows.flatMap((row) => [row.participant_id, row.user_id, row.is_primary_starter])],
  );
  await pool.query("UPDATE event_rosters SET source_roster_revision_id = $1 WHERE id = $2", [nextRevisionId, eventRosterId]);
  await pool.query(
    "UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-admin' WHERE id = $1",
    [eventRosterId],
  );
  await pool.query(
    "UPDATE event_rosters SET status = 'frozen', frozen_at = now(), frozen_by = 'local-admin' WHERE id = $1",
    [eventRosterId],
  );
  await pool.query(
    "UPDATE major_prestart_states SET entrants_locked_at = now(), entrants_locked_by = 'local-admin' WHERE season_id = $1",
    [fixture.seasonId],
  );
  const result = await database.transaction((tx) => startMajorInTransaction(tx, { seasonId: fixture.seasonId, actorId: "local-admin" }));
  if (!result.created || result.matchCount !== 8) throw new Error("重同步后开赛应成功创建 Stage 1。 ");
  const synced = await pool.query<{ source: string; status: string }>(
    "SELECT source_roster_revision_id::text AS source, status::text AS status FROM event_rosters WHERE id = $1",
    [eventRosterId],
  );
  if (synced.rows[0]?.source !== nextRevisionId || synced.rows[0]?.status !== "frozen") {
    throw new Error("重同步后的 event roster 未被冻结到新批准版本。 ");
  }
}

/**
 * requireCompetitiveProfile=true 但报名开放时冻结的 competitiveProfile 缺失/不完整
 * → start 边界显式 fail closed，不允许在没有竞技资格规则的情况下继续开赛。
 */
async function exerciseMissingCompetitiveProfile(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  fixtures: MajorFixture[],
): Promise<void> {
  const fixture = await prepareReadyMajor(pool, "profile-missing");
  fixtures.push(fixture);
  const incompleteProfiles: Array<null | CompetitiveProfileConfig> = [
    null,
    { platform: "", currentSeasonKey: GOLDEN_PROFILE.currentSeasonKey, previousSeasonKey: GOLDEN_PROFILE.previousSeasonKey, rankOrder: GOLDEN_PROFILE.rankOrder },
    { platform: GOLDEN_PROFILE.platform, currentSeasonKey: "", previousSeasonKey: GOLDEN_PROFILE.previousSeasonKey, rankOrder: GOLDEN_PROFILE.rankOrder },
    { platform: GOLDEN_PROFILE.platform, currentSeasonKey: GOLDEN_PROFILE.currentSeasonKey, previousSeasonKey: "", rankOrder: GOLDEN_PROFILE.rankOrder },
    { platform: GOLDEN_PROFILE.platform, currentSeasonKey: GOLDEN_PROFILE.currentSeasonKey, previousSeasonKey: GOLDEN_PROFILE.previousSeasonKey, rankOrder: [] },
  ];
  for (const profile of incompleteProfiles) {
    await pool.query(
      "UPDATE seasons SET team_registration_config = jsonb_set(team_registration_config::jsonb, '{competitiveProfile}', $2::jsonb)::json WHERE id = $1",
      [fixture.seasonId, JSON.stringify(profile)],
    );
    await expectMajorStartFailure(database, fixture.seasonId, "竞技平台目录不完整");
    await assertNoStartFacts(pool, fixture.seasonId);
  }
}

/**
 * Scenario C：approval 后 competitive facts 变坏 → start 被 canonical
 * qualification 拒绝且不留下任何开赛事实；恢复后开赛成功，且 StageRun 冻结
 * 的竞技事实与刚刚通过校验的同一批 facts 一致。
 */
async function exerciseStartQualification(
  database: ReturnType<typeof drizzle<typeof schema>>,
  pool: Pool,
  fixtures: MajorFixture[],
): Promise<void> {
  const fixture = await prepareReadyMajor(pool, "qualification");
  fixtures.push(fixture);
  const victim = fixture.userIds[0]!;
  const platform = GOLDEN_PROFILE.platform;
  const currentKey = GOLDEN_PROFILE.currentSeasonKey;
  const original = await pool.query<{ rank: string; rating: string }>(
    "SELECT rank, rating::text AS rating FROM competitive_rank_facts WHERE user_id = $1 AND platform = $2 AND kind = 'season_peak' AND platform_season_key = $3",
    [victim, platform, currentKey],
  );
  const originalFact = original.rows[0];
  if (!originalFact) throw new Error("qualification fixture 缺少 victim 当前赛季事实。 ");

  // Case A-1：rank 漂移到冻结 rankOrder 之外。
  await pool.query(
    "UPDATE competitive_rank_facts SET rank = 'off-ladder-rank' WHERE user_id = $1 AND platform = $2 AND kind = 'season_peak' AND platform_season_key = $3",
    [victim, platform, currentKey],
  );
  await expectMajorStartFailure(database, fixture.seasonId, "段位映射");
  await assertNoStartFacts(pool, fixture.seasonId);

  // Case A-2：required fact 缺失 → 不允许静默以 null 冻结。
  await pool.query(
    "DELETE FROM competitive_rank_facts WHERE user_id = $1 AND platform = $2 AND kind = 'season_peak' AND platform_season_key = $3",
    [victim, platform, currentKey],
  );
  await expectMajorStartFailure(database, fixture.seasonId, `${platform} · ${currentKey}`);
  await assertNoStartFacts(pool, fixture.seasonId);

  // Case B：恢复合法事实 → 开赛成功，且 frozenCompetitiveFacts 与通过校验的同一批 facts 一致。
  await pool.query(
    `INSERT INTO competitive_rank_facts (id, user_id, platform, kind, platform_season_key, rank, rating)
     VALUES ($1, $2, $3, 'season_peak', $4, $5, $6)`,
    [deterministicUuid("qualification/restored-current"), victim, platform, currentKey, originalFact.rank, originalFact.rating],
  );
  const result = await database.transaction((tx) => startMajorInTransaction(tx, { seasonId: fixture.seasonId, actorId: "local-admin" }));
  if (!result.created || result.matchCount !== 8) throw new Error("恢复合法事实后开赛应成功。 ");
  const snapshotRow = await pool.query<{ rule_snapshot: { frozenCompetitiveFacts?: Array<{ userId: string; historicalPeak: { rank: string; rating: number } | null; previousSeasonPeak: { rank: string; rating: number } | null; currentSeasonPeak: { rank: string; rating: number; sourcePlatform?: string; sourceSeasonKey?: string | null; sourceRank?: string; conversionVersion?: string | null } | null }> } }>(
    "SELECT rule_snapshot FROM major_stage_runs WHERE id = $1",
    [result.stageRunId],
  );
  const frozenFact = snapshotRow.rows[0]?.rule_snapshot?.frozenCompetitiveFacts?.find((row) => row.userId === victim);
  if (!frozenFact) throw new Error("StageRun 冻结竞技事实缺少 victim。 ");
  if (frozenFact.currentSeasonPeak?.rank !== originalFact.rank || frozenFact.currentSeasonPeak?.rating !== Number(originalFact.rating)) {
    throw new Error(`冻结的当前赛季事实与通过 qualification 的 facts 不一致：${JSON.stringify(frozenFact)}`);
  }
  if (frozenFact.currentSeasonPeak.sourcePlatform !== platform || frozenFact.currentSeasonPeak.sourceSeasonKey !== currentKey || frozenFact.currentSeasonPeak.sourceRank !== originalFact.rank || frozenFact.currentSeasonPeak.conversionVersion !== null) {
    throw new Error(`冻结的当前赛季事实缺少可解释的来源：${JSON.stringify(frozenFact.currentSeasonPeak)}`);
  }
  if (!frozenFact.historicalPeak || !frozenFact.previousSeasonPeak) {
    throw new Error("StageRun 冻结竞技事实缺少历史/上赛季峰值。 ");
  }

  // 开赛后 live facts 再变化：已冻结的 StageRun 快照不被改写（消费侧由
  // major-roster-safety S12 覆盖，这里验证冻结事实本身保持不变）。
  await pool.query(
    "UPDATE competitive_rank_facts SET rank = 'live-mutated-after-start' WHERE user_id = $1 AND platform = $2 AND kind = 'season_peak' AND platform_season_key = $3",
    [victim, platform, currentKey],
  );
  const snapshotAfterMutation = await pool.query<{ rule_snapshot: { frozenCompetitiveFacts?: Array<{ userId: string; currentSeasonPeak: { rank: string; rating: number } | null }> } }>(
    "SELECT rule_snapshot FROM major_stage_runs WHERE id = $1",
    [result.stageRunId],
  );
  const frozenAfterMutation = snapshotAfterMutation.rows[0]?.rule_snapshot?.frozenCompetitiveFacts?.find((row) => row.userId === victim);
  if (frozenAfterMutation?.currentSeasonPeak?.rank !== originalFact.rank) {
    throw new Error("开赛后的 live facts 变化不得改写 StageRun 冻结竞技事实。 ");
  }
}

interface MajorLifecycleContext {
  pool: Pool;
  database: ReturnType<typeof drizzle<typeof schema>>;
  fixtures: MajorFixture[];
  ready: MajorFixture | null;
}

async function startAndVerifyMajor(context: MajorLifecycleContext): Promise<void> {
    const ready = await prepareReadyMajor(context.pool, "retry");
    context.fixtures.push(ready);
    const retryResults = await Promise.all([
      context.database.transaction((tx) => startMajorInTransaction(tx, { seasonId: ready.seasonId, actorId: "local-admin-a" })),
      context.database.transaction((tx) => startMajorInTransaction(tx, { seasonId: ready.seasonId, actorId: "local-admin-b" })),
    ]);
    if (retryResults.filter((result) => result.created).length !== 1 || retryResults.some((result) => result.matchCount !== 8)) {
      throw new Error("并发重试没有收敛到一个 Stage 1 运行和 8 场比赛。");
    }

    const client = await context.pool.connect();
    try {
      const started = await client.query<{ status: string; runs: string; entrants: string; matches: string; audits: string; seeds_locked: boolean; rule_snapshot: { version?: number; affiliationRules?: Array<{ institutionCode?: string; minRosterMembers?: number; minStartingMembers?: number }> } }>(`
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
      if (facts?.status !== "playing" || facts.runs !== "1" || facts.entrants !== "16" || facts.matches !== "8" || facts.audits !== "1" || !facts.seeds_locked || facts.rule_snapshot?.version !== 4 || frozenNjuRule?.minRosterMembers !== 3 || frozenNjuRule.minStartingMembers !== 3) {
        throw new Error("正式开赛没有完整固化状态、入口、比赛或审计事实。");
      }
      const firstMatch = await client.query<{ major_stage_run_id: string; entry_a_id: string; entry_b_id: string; stage: string; format: string }>(
        "SELECT major_stage_run_id, entry_a_id, entry_b_id, stage, format FROM matches WHERE season_id = $1 AND ownership = 'major_stage' ORDER BY managed_key LIMIT 1",
        [ready.seasonId],
      );
      const match = firstMatch.rows[0];
      if (!match) throw new Error("未找到已生成的 managed match。");
      await client.query("BEGIN");
      const duplicateManagedMatch = await capturePostgresError(client, () => client.query(
        `INSERT INTO matches (season_id, entry_a_id, entry_b_id, stage, round, format, ownership, major_stage_run_id, managed_key)
         VALUES ($1, $2, $3, $4, 1, $5, 'major_stage', $6, 'r1-1')`,
        [ready.seasonId, match.entry_a_id, match.entry_b_id, match.stage, match.format, match.major_stage_run_id],
      ));
      expect(duplicateManagedMatch).toMatchObject({ code: "23505" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    context.ready = ready;
}

async function advanceMajorStagesAndPlayoff(context: MajorLifecycleContext): Promise<void> {
    const ready = context.ready;
    if (!ready) throw new Error("Stage 1 fixture 尚未启动。");
    const stage1RunId = await exerciseSwissRuntime(context.database, context.pool, ready);
    const stage2Transitions = await Promise.all([
      context.database.transaction((tx) => transitionMajorSwissStageInTransaction(tx, {
        seasonId: ready.seasonId, sourceStageRunId: stage1RunId, actorId: "local-admin-a",
      })),
      context.database.transaction((tx) => transitionMajorSwissStageInTransaction(tx, {
        seasonId: ready.seasonId, sourceStageRunId: stage1RunId, actorId: "local-admin-b",
      })),
    ]);
    if (stage2Transitions.filter((result) => result.created).length !== 1 || new Set(stage2Transitions.map((result) => result.stageRunId)).size !== 1 || stage2Transitions.some((result) => result.stageKey !== "stage2" || result.matchCount !== 8)) {
      throw new Error("并发 Stage 1→Stage 2 切换没有收敛到唯一的 StageRun 和首轮比赛。 ");
    }
    const stage2RunId = stage2Transitions[0]!.stageRunId;
    await completeSwissStage(context.database, context.pool, ready.seasonId, stage2RunId);
    const stage3Transition = await context.database.transaction((tx) => transitionMajorSwissStageInTransaction(tx, {
      seasonId: ready.seasonId, sourceStageRunId: stage2RunId, actorId: "local-admin",
    }));
    if (!stage3Transition.created || stage3Transition.stageKey !== "stage3" || stage3Transition.matchCount !== 8) {
      throw new Error("Stage 2→Stage 3 没有创建完整的下一 StageRun。 ");
    }
    await completeSwissStage(context.database, context.pool, ready.seasonId, stage3Transition.stageRunId);
    const stageTransitionFacts = await context.pool.query<{ runs: string; entrants: string; matches: string; complete_runs: string; transitions: string }>(`
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
    await exercisePlayoffRuntime(context.database, context.pool, ready.seasonId, stage3Transition.stageRunId);
}

async function exerciseStartFailureBoundaries(context: MajorLifecycleContext): Promise<void> {
    const rollback = await prepareReadyMajor(context.pool, "rollback");
    context.fixtures.push(rollback);
    await exerciseMissingCompetitiveProfile(context.database, context.pool, context.fixtures);
    await exerciseStaleRosterCoherence(context.database, context.pool, context.fixtures);
    await exerciseStartQualification(context.database, context.pool, context.fixtures);
    const triggerClient = await context.pool.connect();
    try {
      await triggerClient.query(`
        CREATE FUNCTION fail_local_major_start_match() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'local major start rollback sentinel'; END;
        $$;
        CREATE TRIGGER fail_local_major_start_match BEFORE INSERT ON matches
        FOR EACH ROW WHEN (NEW.ownership = 'major_stage') EXECUTE FUNCTION fail_local_major_start_match();
      `);
      await context.database.transaction((tx) => startMajorInTransaction(tx, { seasonId: rollback.seasonId, actorId: "local-admin" }))
        .then(() => { throw new Error("预期启动事务因 sentinel 回滚，但操作成功。"); })
        .catch((error) => {
          // drizzle 会把 pg 错误包装成 DrizzleQueryError，sentinel 文本在 cause 里。
          const message = [
            error instanceof Error ? error.message : String(error),
            error instanceof Error && error.cause instanceof Error ? error.cause.message : "",
          ].join(" ");
          if (!message.includes("rollback sentinel")) throw error;
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
}

describe.sequential("Major lifecycle PostgreSQL invariants", () => {
  let context: MajorLifecycleContext;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
    context = { pool, database: drizzle(pool, { schema }), fixtures: [], ready: null };
    await cleanupStaleMajorStartFixtures(pool);
  });

  afterAll(async () => {
    for (const fixture of context.fixtures) await cleanupMajorFixture(context.pool, fixture);
    await context.pool.end();
  });

  it("serializes prestart roster and Entry remediation", async () => {
    await exerciseStartVsRosterChangeConcurrency(context.database, context.pool, context.fixtures);
    await exerciseSaveVsRosterChangeConcurrency(context.database, context.pool, context.fixtures);
  });

  it("closes self-service roster changes at rosterChangeClosesAt", async () => {
    await exerciseSelfRosterChangeDeadline(context.database, context.pool, context.fixtures);
  });

  it("starts Stage 1 once and freezes canonical runtime facts", async () => {
    await startAndVerifyMajor(context);
  });

  it("advances three Swiss StageRuns and finalizes the playoff", async () => {
    await advanceMajorStagesAndPlayoff(context);
  });

  it("fails closed for stale roster, qualification, and rollback boundaries", async () => {
    await exerciseStartFailureBoundaries(context);
  });
});
