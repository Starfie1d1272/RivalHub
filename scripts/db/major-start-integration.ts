import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/db/schema";
import { startMajorInTransaction } from "../../src/lib/major/start";
import { finalizeMajorSwissRoundInTransaction } from "../../src/lib/major/swiss-runtime";
import { transitionMajorSwissStageInTransaction } from "../../src/lib/major/stage-transition";
import { finalizeMajorPlayoffRoundInTransaction, startMajorPlayoffInTransaction } from "../../src/lib/major/playoff-runtime";
import { AppError, ErrorCode } from "../../src/lib/errors";
import { createMajorDefaultCapabilities } from "../../src/types/season";

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

async function prepareReadyMajor(pool: Pool, label: string): Promise<MajorFixture> {
  const client = await pool.connect();
  const seasonId = randomUUID();
  const teamIds = Array.from({ length: 32 }, () => randomUUID());
  const applicationIds = Array.from({ length: 32 }, () => randomUUID());
  const userIds = Array.from({ length: 160 }, () => randomUUID());
  const memberIds = Array.from({ length: 160 }, () => randomUUID());
  const capabilities = createMajorDefaultCapabilities();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seasons (
        id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions
      ) VALUES ($1, $2, 'Local Major Start', 'Major', 'registration', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
      [
        seasonId, `local-major-start-${label}-${seasonId}`,
        capabilities.registrationMode, capabilities.hasCaptainVoting, capabilities.hasDraft,
        JSON.stringify(capabilities.stagePlan), JSON.stringify(capabilities.registrationConfig),
        JSON.stringify(capabilities.teamRegistrationConfig), JSON.stringify(capabilities.affiliationRules),
        capabilities.minTeamSize, capabilities.maxTeamSize, capabilities.starterCount, capabilities.positions,
      ],
    );
    await client.query(
      `INSERT INTO users (id, email, email_verified_at) SELECT value::uuid, 'major-start-' || value || '@local.test', now()
       FROM unnest($1::text[]) AS value`,
      [userIds],
    );
    await client.query(
      `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at)
       SELECT u.id, i.id, 'enrolled', 'manual_other', 'approved', 'local-admin', now()
       FROM users u
       CROSS JOIN institutions i
       WHERE u.id = ANY($1::uuid[]) AND i.moe_institution_code = '4132010284'`,
      [userIds],
    );
    for (let index = 0; index < 32; index += 1) {
      await client.query(
        `INSERT INTO team_applications (id, season_id, name, captain_user_id, status)
         VALUES ($1, $2, $3, $4, 'approved')`,
        [applicationIds[index], seasonId, `Team ${index + 1}`, userIds[index * 5]],
      );
      await client.query(
        `INSERT INTO teams (id, season_id, name, captain_user_id, team_application_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [teamIds[index], seasonId, `Team ${index + 1}`, userIds[index * 5], applicationIds[index]],
      );
      for (let offset = 0; offset < 5; offset += 1) {
        const userId = userIds[index * 5 + offset];
        await client.query(
          `INSERT INTO team_application_members (id, application_id, user_id, invited_by_user_id, status, confirmed_at)
           VALUES ($1, $2, $3, $4, 'confirmed', now())`,
          [memberIds[index * 5 + offset], applicationIds[index], userId, userIds[index * 5]],
        );
        await client.query(
          `INSERT INTO team_members (team_id, season_id, user_id, team_application_member_id)
           VALUES ($1, $2, $3, $4)`,
          [teamIds[index], seasonId, userId, memberIds[index * 5 + offset]],
        );
      }
    }
    await client.query(
      `INSERT INTO major_prestart_states (season_id, entrants_locked_at, entrants_locked_by, seed_revision, confirmed_seed_revision)
       VALUES ($1, now(), 'local-admin', 1, 1)`,
      [seasonId],
    );
    for (let index = 0; index < 32; index += 1) {
      const entrant = await client.query<{ id: string }>(
        `INSERT INTO major_prestart_entrants (season_id, team_id, roster_confirmed_at, roster_confirmed_by)
         VALUES ($1, $2, now(), 'local-admin') RETURNING id`,
        [seasonId, teamIds[index]],
      );
      const entrantId = entrant.rows[0]?.id;
      if (!entrantId) throw new Error("正式参赛队创建失败。");
      await client.query(
        `INSERT INTO major_prestart_roster_members (entrant_id, user_id, education_verification_id)
         SELECT $1, m.user_id, v.id
         FROM team_members m
         INNER JOIN education_verifications v ON v.user_id = m.user_id AND v.status = 'approved'
         WHERE m.season_id = $2 AND m.team_id = $3`,
        [entrantId, seasonId, teamIds[index]],
      );
      await client.query(
        `INSERT INTO major_tournament_seeds (season_id, entrant_id, tournament_seed) VALUES ($1, $2, $3)`,
        [seasonId, entrantId, index + 1],
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
    await client.query("DELETE FROM major_final_results WHERE season_id = $1", [fixture.seasonId]);
    await client.query(`DELETE FROM major_stage_entrants e USING major_stage_runs r
      WHERE e.stage_run_id = r.id AND r.season_id = $1`, [fixture.seasonId]);
    await client.query("DELETE FROM major_stage_runs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_tournament_seeds WHERE season_id = $1", [fixture.seasonId]);
    await client.query(`DELETE FROM major_prestart_roster_members r USING major_prestart_entrants e
      WHERE r.entrant_id = e.id AND e.season_id = $1`, [fixture.seasonId]);
    await client.query("DELETE FROM major_prestart_entrants WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM major_prestart_states WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM team_members WHERE season_id = $1", [fixture.seasonId]);
    await client.query(`DELETE FROM team_application_members m USING team_applications a
      WHERE m.application_id = a.id AND a.season_id = $1`, [fixture.seasonId]);
    await client.query("DELETE FROM teams WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM team_applications WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
    await client.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [fixture.userIds]);
    await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [fixture.userIds]);
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
      SELECT s.id AS season_id, COALESCE(array_agg(DISTINCT tm.user_id) FILTER (WHERE tm.user_id IS NOT NULL), '{}') AS user_ids
      FROM seasons s
      LEFT JOIN team_members tm ON tm.season_id = s.id
      WHERE s.slug LIKE 'local-major-start-%'
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

async function finishPlayoffRound(pool: Pool, stageRunId: string, round: "quarterfinal" | "semifinal" | "final"): Promise<void> {
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
    database.transaction((tx) => startMajorPlayoffInTransaction(tx, { seasonId, sourceStageRunId: stage3RunId, actorId: "local-admin-a" })),
    database.transaction((tx) => startMajorPlayoffInTransaction(tx, { seasonId, sourceStageRunId: stage3RunId, actorId: "local-admin-b" })),
  ]);
  if (starts.filter((result) => result.created).length !== 1 || new Set(starts.map((result) => result.stageRunId)).size !== 1 || starts.some((result) => result.matchCount !== 4)) {
    throw new Error("并发 Stage 3→Playoff 没有收敛到唯一的淘汰赛 StageRun。 ");
  }
  const playoffRunId = starts[0]!.stageRunId;
  for (const round of ["quarterfinal", "semifinal", "final"] as const) {
    await finishPlayoffRound(pool, playoffRunId, round);
    const result = await database.transaction((tx) => finalizeMajorPlayoffRoundInTransaction(tx, {
      seasonId, stageRunId: playoffRunId, expectedRound: round, actorId: "local-admin",
    }));
    const expectedNext = ({ quarterfinal: 2, semifinal: 1, final: 0 } as const)[round];
    if (result.createdNextRound !== expectedNext || result.resultPendingConfirmation !== (round === "final")) {
      throw new Error(`${round} 没有生成预期的下一轮或待确认赛事结果。 `);
    }
  }
  const facts = await pool.query<{ matches: string; champion: string | null; status: string | null; has_three_four: boolean; groups: string }>(`
    SELECT
      (SELECT count(*) FROM matches WHERE major_stage_run_id = $1 AND ownership = 'major_stage') AS matches,
      (SELECT champion_team_id::text FROM major_final_results WHERE playoff_stage_run_id = $1) AS champion,
      (SELECT status::text FROM major_final_results WHERE playoff_stage_run_id = $1) AS status,
      (SELECT EXISTS(SELECT 1 FROM major_final_results, jsonb_to_recordset(placement_groups) AS p("from" integer, "to" integer, "teamIds" jsonb) WHERE playoff_stage_run_id = $1 AND p."from" = 3 AND p."to" = 4)) AS has_three_four,
      (SELECT jsonb_array_length(placement_groups)::text FROM major_final_results WHERE playoff_stage_run_id = $1) AS groups
  `, [playoffRunId]);
  const fact = facts.rows[0];
  if (!fact || fact.matches !== "7" || !fact.champion || fact.status !== "pending_confirmation" || !fact.has_three_four || fact.groups !== "13") {
    throw new Error("淘汰赛没有持久化七场比赛、冠军、3–4 名次区间与待确认正式结果。 ");
  }
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
      const firstMatch = await client.query<{ major_stage_run_id: string; team_a_id: string; team_b_id: string; stage: string; format: string }>(
        "SELECT major_stage_run_id, team_a_id, team_b_id, stage, format FROM matches WHERE season_id = $1 AND ownership = 'major_stage' ORDER BY managed_key LIMIT 1",
        [ready.seasonId],
      );
      const match = firstMatch.rows[0];
      if (!match) throw new Error("未找到已生成的 managed match。");
      await client.query("BEGIN");
      await expectPgError(client, () => client.query(
        `INSERT INTO matches (season_id, team_a_id, team_b_id, stage, round, format, ownership, major_stage_run_id, managed_key)
         VALUES ($1, $2, $3, $4, 1, $5, 'major_stage', $6, 'r1-1')`,
        [ready.seasonId, match.team_a_id, match.team_b_id, match.stage, match.format, match.major_stage_run_id],
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
