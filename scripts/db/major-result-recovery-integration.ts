/**
 * PR G2 — 比分更正与恢复真实 PostgreSQL 集成测试。
 *
 * 覆盖场景：
 *  A. semifinal winner correction invalidates/rebuilds final + third-place
 *  B/C. started or finished final/third-place blocks automatic recovery
 *  D. quarterfinal correction invalidates only its actual semifinal path
 *  B. 下游生成前的胜者更正（无需作废任何比赛，修正后 finalize 可重建）
 *  A. 同胜者比分笔误最小更正（含弃赛形态）
 *  C. 下游已生成但未开始：plan 展示影响 → 显式确认恢复 → 作废未开始下游
 *     + 回滚 finalizedRound → 经既有 finalize 确定性重建
 *  E. 重复更正请求幂等；重复 finalize 幂等
 *  D. 已开始的下游托管比赛 → fail closed，禁止自动重写
 *  F. 官方名次存在时禁止胜者更正（赛后裁决边界）
 *  G. 后续阶段 StageRun 已建立时禁止本阶段胜者更正（stage transition 边界）
 *
 * 托管比赛 team_a = 高种子方。fixture 默认高种子获胜；flips 指定场次由低种子爆冷获胜。
 *
 * 只允许 loopback Local Supabase。
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/db/schema";
import {
  applyResultCorrectionInTx,
  planResultCorrectionInTx,
} from "../../src/lib/match-corrections/service";
import { finalizeMajorPlayoffRoundInTransaction } from "../../src/lib/major/playoff-runtime";
import { finalizeMajorSwissRoundInTransaction } from "../../src/lib/major/swiss-runtime";
import { generateNextMajorSwissRound } from "../../src/lib/major/swiss";
import { AppError, ErrorCode } from "../../src/lib/errors";
import { createMajorDefaultCapabilities } from "../../src/types/season";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("结果恢复集成测试只允许 Local Supabase loopback 数据库。");
}

const ACTOR = "local-admin-g2";

function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function expectAppError(
  work: () => Promise<unknown>,
  code: ErrorCode,
  messageIncludes?: string,
  hint?: string,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError && error.code === code) {
      if (messageIncludes && !error.message.includes(messageIncludes)) {
        throw new Error(
          `${hint ?? "操作"}：错误码匹配但文案缺失「${messageIncludes}」，实际「${error.message}」`,
        );
      }
      return;
    }
    throw new Error(`${hint ?? "操作"}：预期 AppError(${code})，实际 ${String(error)}`);
  }
  throw new Error(`${hint ?? "操作"}：预期失败（${code}），但操作成功。`);
}

interface RecoveryFixture {
  seasonId: string;
  stageKeysWithRuns: { stageKey: string; runId: string }[];
}

interface PlayoffRecoveryFixture extends RecoveryFixture {
  playoffRunId: string;
  teamIds: string[];
  quarterfinalMatchIds: string[];
  semifinalMatchIds: string[];
  finalMatchId: string;
  thirdPlaceMatchId: string;
}

const STAGE_PLAN_KEYS = ["stage1", "stage2", "stage3", "playoff"];

async function prepareFixture(
  pool: Pool,
  label: string,
  extraStageKeys: string[] = [],
): Promise<RecoveryFixture> {
  const client = await pool.connect();
  const seasonId = randomUUID();
  const capabilities = createMajorDefaultCapabilities();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seasons (
        id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft,
        stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions
      ) VALUES ($1, $2, 'Local Major Recovery', 'Major', 'playing', $3, $4, $5, $6::json, $7::json, $8::json, $9::json, $10, $11, $12, $13::text[])`,
      [
        seasonId,
        `local-major-recovery-${label}-${seasonId}`,
        capabilities.registrationMode,
        capabilities.hasCaptainVoting,
        capabilities.hasDraft,
        JSON.stringify(capabilities.stagePlan),
        JSON.stringify(capabilities.registrationConfig),
        JSON.stringify(capabilities.teamRegistrationConfig),
        JSON.stringify(capabilities.affiliationRules),
        capabilities.minTeamSize,
        capabilities.maxTeamSize,
        capabilities.starterCount,
        capabilities.positions,
      ],
    );

    const userIds = Array.from({ length: 16 }, () => randomUUID());
    for (let i = 0; i < userIds.length; i += 1) {
      await client.query(`INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())`, [
        userIds[i], `g2-${i}-${seasonId}@local.test`,
      ]);
    }
    const teamIds: string[] = [];
    const prestartEntrantIds: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      const applicationId = randomUUID();
      const teamId = randomUUID();
      const memberId = randomUUID();
      teamIds.push(teamId);
      await client.query(
        `INSERT INTO team_applications (id, season_id, name, captain_user_id, status)
         VALUES ($1, $2, $3, $4, 'approved')`,
        [applicationId, seasonId, `Team ${i + 1}`, userIds[i]],
      );
      await client.query(
        `INSERT INTO teams (id, season_id, name, captain_user_id, team_application_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [teamId, seasonId, `Team ${i + 1}`, userIds[i], applicationId],
      );
      await client.query(
        `INSERT INTO team_application_members (id, application_id, user_id, invited_by_user_id, status, confirmed_at)
         VALUES ($1, $2, $3, $4, 'confirmed', now())`,
        [memberId, applicationId, userIds[i], userIds[i]],
      );
      await client.query(
        `INSERT INTO team_members (team_id, season_id, user_id, team_application_member_id)
         VALUES ($1, $2, $3, $4)`,
        [teamId, seasonId, userIds[i], memberId],
      );
      const entrant = await client.query<{ id: string }>(
        `INSERT INTO major_prestart_entrants (season_id, team_id, roster_confirmed_at, roster_confirmed_by)
         VALUES ($1, $2, now(), 'local-admin') RETURNING id`,
        [seasonId, teamId],
      );
      prestartEntrantIds.push(entrant.rows[0]!.id);
    }

    await client.query(
      `INSERT INTO major_prestart_states (season_id, entrants_locked_at, entrants_locked_by, seed_revision, confirmed_seed_revision)
       VALUES ($1, now(), 'local-admin', 1, 1)`,
      [seasonId],
    );

    const stageKeys = ["stage1", ...extraStageKeys];
    const stageKeysWithRuns: { stageKey: string; runId: string }[] = [];
    for (const stageKey of stageKeys) {
      const ruleSnapshot = {
        version: 2,
        stage: stageKey === "playoff"
          ? { key: stageKey, name: stageKey, type: "single_elim", teamCount: 8, matchFormat: "bo3", finalFormat: "bo5" }
          : { key: stageKey, type: "swiss", teamCount: 16, matchFormat: "bo1" },
        rosterRules: { minTeamSize: capabilities.minTeamSize, maxTeamSize: capabilities.maxTeamSize, starterCount: capabilities.starterCount },
        affiliationRules: [],
        stagePlan: STAGE_PLAN_KEYS.map((key) => ({ key })),
        tournamentEntrants: [],
        tournamentSeeds: [],
        openingPairings: [],
      };
      const run = await client.query<{ id: string }>(
        `INSERT INTO major_stage_runs (season_id, stage_key, rule_snapshot, started_by)
         VALUES ($1, $2, $3::jsonb, 'local-admin') RETURNING id`,
        [seasonId, stageKey, JSON.stringify(ruleSnapshot)],
      );
      const runId = run.rows[0]!.id;
      stageKeysWithRuns.push({ stageKey, runId });
      if (stageKey === "stage1") {
        for (let i = 0; i < 16; i += 1) {
          await client.query(
            `INSERT INTO major_stage_entrants (stage_run_id, entrant_id, team_id, tournament_seed, stage_seed)
             VALUES ($1, $2, $3, $4, $4)`,
            [runId, prestartEntrantIds[i], teamIds[i], i + 1],
          );
        }
      }
    }

    await client.query("COMMIT");
    return { seasonId, stageKeysWithRuns };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function preparePlayoffFixture(pool: Pool, label: string): Promise<PlayoffRecoveryFixture> {
  const fixture = await prepareFixture(pool, `playoff-${label}`, ["playoff"]);
  const playoffRun = fixture.stageKeysWithRuns.find((run) => run.stageKey === "playoff");
  if (!playoffRun) throw new Error("playoff recovery fixture 缺少淘汰赛 StageRun。 ");

  const capabilities = createMajorDefaultCapabilities();
  const frozenStages = capabilities.stagePlan.map((stage) => ({
    key: stage.key,
    name: stage.name,
    type: stage.type,
    teamCount: stage.teamCount,
    matchFormat: stage.matchFormat,
    finalFormat: stage.finalFormat ?? null,
  }));
  const playoffStage = frozenStages.find((stage) => stage.key === "playoff");
  if (!playoffStage) throw new Error("playoff recovery fixture 缺少冻结淘汰赛规则。 ");

  const client = await pool.connect();
  try {
    const entrants = await client.query<{ entrant_id: string; team_id: string }>(
      `SELECT id AS entrant_id, team_id FROM major_prestart_entrants
       WHERE season_id = $1 ORDER BY id LIMIT 8`,
      [fixture.seasonId],
    );
    if (entrants.rows.length !== 8) throw new Error("playoff recovery fixture 必须有 8 支淘汰赛队伍。 ");
    const teamIds = entrants.rows.map((row) => row.team_id);
    const tournamentEntrants = Array.from({ length: 32 }, (_, index) => ({
      entrantId: randomUUID(),
      teamId: randomUUID(),
      tournamentSeed: index + 1,
    }));
    await client.query(
      `UPDATE major_stage_runs SET rule_snapshot = $2::jsonb WHERE id = $1`,
      [playoffRun.runId, JSON.stringify({
        stagePlan: frozenStages,
        stage: playoffStage,
        tournamentEntrants,
        hasThirdPlaceMatch: true,
      })],
    );
    for (let index = 0; index < teamIds.length; index += 1) {
      await client.query(
        `INSERT INTO major_stage_entrants (stage_run_id, entrant_id, team_id, tournament_seed, stage_seed)
         VALUES ($1, $2, $3, $4, $4)`,
        [playoffRun.runId, entrants.rows[index]!.entrant_id, teamIds[index], index + 1],
      );
    }

    const qfPairs = [
      [teamIds[0]!, teamIds[7]!],
      [teamIds[3]!, teamIds[4]!],
      [teamIds[1]!, teamIds[6]!],
      [teamIds[2]!, teamIds[5]!],
    ];
    const quarterfinalMatchIds: string[] = [];
    for (const [index, pair] of qfPairs.entries()) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO matches (
           season_id, team_a_id, team_b_id, stage, entry_round, format, status,
           score_a, score_b, completed_at, ownership, major_stage_run_id, managed_key
         ) VALUES ($1, $2, $3, 'playoff', 'quarterfinal', 'bo3', 'finished', 2, 1, now(), 'major_stage', $4, $5)
         RETURNING id`,
        [fixture.seasonId, pair[0], pair[1], playoffRun.runId, `qf-${index + 1}`],
      );
      quarterfinalMatchIds.push(result.rows[0]!.id);
    }

    const semifinalPairs = [
      [teamIds[0]!, teamIds[3]!],
      [teamIds[1]!, teamIds[2]!],
    ];
    const semifinalMatchIds: string[] = [];
    for (const [index, pair] of semifinalPairs.entries()) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO matches (
           season_id, team_a_id, team_b_id, stage, entry_round, format, status,
           score_a, score_b, completed_at, ownership, major_stage_run_id, managed_key
         ) VALUES ($1, $2, $3, 'playoff', 'semifinal', 'bo3', 'finished', 2, 1, now(), 'major_stage', $4, $5)
         RETURNING id`,
        [fixture.seasonId, pair[0], pair[1], playoffRun.runId, `sf-${index + 1}`],
      );
      semifinalMatchIds.push(result.rows[0]!.id);
    }

    const final = await client.query<{ id: string }>(
      `INSERT INTO matches (
         season_id, team_a_id, team_b_id, stage, entry_round, format, status,
         ownership, major_stage_run_id, managed_key
       ) VALUES ($1, $2, $3, 'playoff', 'final', 'bo5', 'scheduled', 'major_stage', $4, 'final-1')
       RETURNING id`,
      [fixture.seasonId, teamIds[0], teamIds[1], playoffRun.runId],
    );
    const third = await client.query<{ id: string }>(
      `INSERT INTO matches (
         season_id, team_a_id, team_b_id, stage, entry_round, format, status,
         ownership, major_stage_run_id, managed_key
       ) VALUES ($1, $2, $3, 'playoff', 'third_place', 'bo3', 'scheduled', 'major_stage', $4, 'third-1')
       RETURNING id`,
      [fixture.seasonId, teamIds[3], teamIds[2], playoffRun.runId],
    );
    return {
      ...fixture,
      playoffRunId: playoffRun.runId,
      teamIds,
      quarterfinalMatchIds,
      semifinalMatchIds,
      finalMatchId: final.rows[0]!.id,
      thirdPlaceMatchId: third.rows[0]!.id,
    };
  } finally {
    client.release();
  }
}

interface R1Context {
  matchIdsByIndex: string[];
}

async function generateAndInsertRound1(pool: Pool, fixture: RecoveryFixture): Promise<R1Context> {
  const run = fixture.stageKeysWithRuns[0]!;
  const client = await pool.connect();
  try {
    const entrantRows = await client.query<{ team_id: string; stage_seed: number }>(
      `SELECT team_id, stage_seed FROM major_stage_entrants WHERE stage_run_id = $1 ORDER BY stage_seed`,
      [run.runId],
    );
    const entrants = entrantRows.rows.map((row) => ({
      teamId: row.team_id,
      initialStageSeed: row.stage_seed,
    }));
    const pairings = generateNextMajorSwissRound({
      entrants,
      matches: [],
      finalizedRound: 0,
      stageMatchFormat: "bo1",
    });
    assertCondition(pairings.length === 8, "engine 必须给出 8 场首轮对阵");

    const ids: string[] = [];
    for (let index = 0; index < pairings.length; index += 1) {
      const pairing = pairings[index]!;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO matches (
           season_id, team_a_id, team_b_id, stage, round, format, status,
           ownership, major_stage_run_id, managed_key
         ) VALUES ($1, $2, $3, 'stage1', 1, $4, 'scheduled', 'major_stage', $5, $6)
         RETURNING id`,
        [
          fixture.seasonId, pairing.higherSeedTeamId, pairing.lowerSeedTeamId,
          pairing.format, run.runId, `r1-${index + 1}`,
        ],
      );
      ids.push(inserted.rows[0]!.id);
    }
    return { matchIdsByIndex: ids };
  } finally {
    client.release();
  }
}

async function finishRound1Matches(
  pool: Pool,
  ctx: R1Context,
  options: { flipMatchIndexes?: number[] } = {},
): Promise<void> {
  const flips = new Set(options.flipMatchIndexes ?? []);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let index = 0; index < ctx.matchIdsByIndex.length; index += 1) {
      const matchId = ctx.matchIdsByIndex[index]!;
      // flipped: 高种子(A) 9 : 低种子(B) 13 —— 爆冷；否则 A 13:4。
      const [scoreA, scoreB] = flips.has(index) ? [9, 13] : [13, 4];
      await client.query(
        `UPDATE matches SET score_a = $2, score_b = $3, status = 'finished', completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [matchId, scoreA, scoreB],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function countManagedMatches(client: PoolClient, runId: string, round: number): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM matches WHERE major_stage_run_id = $1 AND round = $2 AND ownership = 'major_stage'`,
    [runId, round],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function auditCount(client: PoolClient, action: string, targetId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_logs WHERE action = $1 AND target_id = $2`,
    [action, targetId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function getMatchFact(client: PoolClient, matchId: string): Promise<{ scoreA: number; scoreB: number; isForfeit: boolean }> {
  const row = await client.query<{ score_a: number; score_b: number; is_forfeit: boolean }>(
    `SELECT score_a, score_b, is_forfeit FROM matches WHERE id = $1`,
    [matchId],
  );
  return {
    scoreA: row.rows[0]!.score_a,
    scoreB: row.rows[0]!.score_b,
    isForfeit: row.rows[0]!.is_forfeit,
  };
}

async function getFinalizedRound(client: PoolClient, runId: string): Promise<number> {
  const row = await client.query<{ finalized_round: number }>(
    `SELECT finalized_round FROM major_stage_runs WHERE id = $1`, [runId]);
  return row.rows[0]!.finalized_round;
}

async function cleanupFixture(pool: Pool, fixture: RecoveryFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM audit_logs WHERE season_id = $1", [fixture.seasonId]);
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
    await client.query(`DELETE FROM users WHERE email LIKE '%' || $1 || '%'`, [fixture.seasonId]);
    await client.query("DELETE FROM seasons WHERE id = $1", [fixture.seasonId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 6 });
  const database = drizzle(pool, { schema });
  const fixtures: RecoveryFixture[] = [];

  try {
    // ── A：半决赛胜者更正必须同时恢复决赛和季军赛 ────────────────────────
    {
      const fixture = await preparePlayoffFixture(pool, "semifinal-rebuild");
      fixtures.push(fixture);
      const semifinalId = fixture.semifinalMatchIds[0]!;

      const plan = await database.transaction((tx) => planResultCorrectionInTx(tx, {
        matchId: semifinalId,
        proposal: { scoreA: 1, scoreB: 2 },
      }));
      assertCondition(plan.winnerChanges, "A 计划必须识别半决赛胜者变更");
      assertCondition(plan.impacts.filter((impact) => impact.kind === "downstream_match").length === 2, "A 影响清单必须包含决赛和季军赛");
      assertCondition(plan.impacts.every((impact) => impact.status === "scheduled"), "A 下游比赛必须仍未开始");

      const applied = await database.transaction((tx) => applyResultCorrectionInTx(tx, {
        matchId: semifinalId,
        proposal: { scoreA: 1, scoreB: 2 },
        actorId: ACTOR,
        confirmRecovery: true,
      }));
      assertCondition(applied.invalidatedDownstreamMatches.length === 2, "A 必须同时作废决赛和季军赛");
      assertCondition(applied.winnerChanged, "A 必须落库胜者变更");

      const rebuilt = await database.transaction((tx) => finalizeMajorPlayoffRoundInTransaction(tx, {
        seasonId: fixture.seasonId,
        stageRunId: fixture.playoffRunId,
        expectedRound: "semifinal",
        actorId: ACTOR,
      }));
      assertCondition(rebuilt.createdNextRound === 2 && !rebuilt.alreadyFinalized, "A 现有 playoff runtime 必须重建两场后续比赛");

      const rebuiltRows = await pool.query<{ entry_round: string; team_a_id: string; team_b_id: string }>(
        `SELECT entry_round, team_a_id, team_b_id FROM matches
         WHERE major_stage_run_id = $1 AND entry_round IN ('final', 'third_place')
         ORDER BY entry_round`,
        [fixture.playoffRunId],
      );
      const byRound = new Map(rebuiltRows.rows.map((row) => [row.entry_round, row]));
      const finalRow = byRound.get("final");
      const thirdRow = byRound.get("third_place");
      assertCondition(Boolean(finalRow && thirdRow), "A 重建后必须保留决赛与季军赛");
      assertCondition(
        finalRow!.team_a_id === fixture.teamIds[3] && finalRow!.team_b_id === fixture.teamIds[1],
        "A 决赛必须使用更正后的半决赛胜者",
      );
      assertCondition(
        thirdRow!.team_a_id === fixture.teamIds[0] && thirdRow!.team_b_id === fixture.teamIds[2],
        "A 季军赛必须使用更正后的半决赛负者",
      );
    }

    // ── B / C：决赛或季军赛已开始/完成时禁止自动恢复 ────────────────────
    {
      const fixture = await preparePlayoffFixture(pool, "started-downstream");
      fixtures.push(fixture);
      const semifinalId = fixture.semifinalMatchIds[0]!;
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE matches SET status = 'in_progress', updated_at = now() WHERE id = $1`,
          [fixture.finalMatchId],
        );
      } finally {
        client.release();
      }
      await expectAppError(
        () => database.transaction((tx) => applyResultCorrectionInTx(tx, {
          matchId: semifinalId,
          proposal: { scoreA: 1, scoreB: 2 },
          actorId: ACTOR,
          confirmRecovery: true,
        })),
        ErrorCode.VALIDATION_FAILED,
        "已经开始或完成",
        "B 决赛已开始时必须硬阻断",
      );

      const resetClient = await pool.connect();
      try {
        await resetClient.query(
          `UPDATE matches SET status = 'scheduled', updated_at = now() WHERE id = $1`,
          [fixture.finalMatchId],
        );
        await resetClient.query(
          `UPDATE matches SET status = 'finished', score_a = 2, score_b = 1, completed_at = now(), updated_at = now() WHERE id = $1`,
          [fixture.thirdPlaceMatchId],
        );
      } finally {
        resetClient.release();
      }
      await expectAppError(
        () => database.transaction((tx) => applyResultCorrectionInTx(tx, {
          matchId: semifinalId,
          proposal: { scoreA: 1, scoreB: 2 },
          actorId: ACTOR,
          confirmRecovery: true,
        })),
        ErrorCode.VALIDATION_FAILED,
        "已经开始或完成",
        "C 季军赛已完成时必须硬阻断",
      );
    }

    // ── D：四分之一决赛只影响其所在半区，不作废另一场半决赛 ────────────
    {
      const fixture = await preparePlayoffFixture(pool, "quarterfinal-dependency");
      fixtures.push(fixture);
      const client = await pool.connect();
      try {
        await client.query(
          `DELETE FROM matches WHERE id IN ($1, $2)`,
          [fixture.finalMatchId, fixture.thirdPlaceMatchId],
        );
        await client.query(
          `UPDATE matches SET status = 'scheduled', score_a = NULL, score_b = NULL, completed_at = NULL, updated_at = now()
           WHERE id = $1`,
          [fixture.semifinalMatchIds[0]],
        );
        await client.query(
          `UPDATE matches SET status = 'scheduled', score_a = NULL, score_b = NULL, completed_at = NULL, updated_at = now()
           WHERE id = $1`,
          [fixture.semifinalMatchIds[1]],
        );
      } finally {
        client.release();
      }

      const qfId = fixture.quarterfinalMatchIds[0]!;
      const plan = await database.transaction((tx) => planResultCorrectionInTx(tx, {
        matchId: qfId,
        proposal: { scoreA: 1, scoreB: 2 },
      }));
      const downstream = plan.impacts.filter((impact) => impact.kind === "downstream_match");
      assertCondition(downstream.length === 1, "D 影响清单只能包含受影响的一场半决赛");
      assertCondition(downstream[0]!.managedKey === "sf-1", "D 影响清单必须指向 qf-1 所属的 sf-1");

      const applied = await database.transaction((tx) => applyResultCorrectionInTx(tx, {
        matchId: qfId,
        proposal: { scoreA: 1, scoreB: 2 },
        actorId: ACTOR,
        confirmRecovery: true,
      }));
      assertCondition(applied.invalidatedDownstreamMatches.length === 1, "D 只能作废受影响的半决赛");

      const rebuilt = await database.transaction((tx) => finalizeMajorPlayoffRoundInTransaction(tx, {
        seasonId: fixture.seasonId,
        stageRunId: fixture.playoffRunId,
        expectedRound: "quarterfinal",
        actorId: ACTOR,
      }));
      assertCondition(rebuilt.createdNextRound === 1, "D 只应补建缺失的半决赛");
      const remaining = await pool.query<{ id: string; managed_key: string; team_a_id: string; team_b_id: string }>(
        `SELECT id, managed_key, team_a_id, team_b_id FROM matches
         WHERE major_stage_run_id = $1 AND entry_round = 'semifinal' ORDER BY managed_key`,
        [fixture.playoffRunId],
      );
      assertCondition(remaining.rows.length === 2, "D 重建后必须有两场半决赛");
      assertCondition(remaining.rows.some((row) => row.id === fixture.semifinalMatchIds[1]), "D 无关的 sf-2 必须保留");
      const rebuiltSf1 = remaining.rows.find((row) => row.managed_key === "sf-1");
      assertCondition(
        rebuiltSf1?.team_a_id === fixture.teamIds[7] && rebuiltSf1.team_b_id === fixture.teamIds[3],
        "D sf-1 必须使用更正后的四分之一决赛胜者",
      );
    }

    // ── B：下游尚未生成的胜者更正 ──────────────────────────────────────
    {
      const fixture = await prepareFixture(pool, "before-downstream");
      fixtures.push(fixture);
      const run = fixture.stageKeysWithRuns[0]!;
      const r1 = await generateAndInsertRound1(pool, fixture);
      // m0 爆冷：低种子 13:9 取胜，随后管理员更正回高种子获胜。
      await finishRound1Matches(pool, r1, { flipMatchIndexes: [0] });

      const m0 = r1.matchIdsByIndex[0]!;
      await expectAppError(
        () => database.transaction((tx) =>
          applyResultCorrectionInTx(tx, {
            matchId: m0,
            proposal: { scoreA: 13, scoreB: 4 },
            actorId: ACTOR,
          }),
        ),
        ErrorCode.VALIDATION_FAILED,
        undefined,
        "B1 缺少恢复确认必须拒绝",
      );

      const applied = await database.transaction((tx) =>
        applyResultCorrectionInTx(tx, {
          matchId: m0,
          proposal: { scoreA: 13, scoreB: 4 },
          actorId: ACTOR,
          confirmRecovery: true,
        }),
      );
      assertCondition(!applied.alreadyApplied && applied.winnerChanged, "B2 应应用胜者变更");
      assertCondition(applied.invalidatedDownstreamMatches.length === 0, "B2 无下游时不应作废任何比赛");

      const client = await pool.connect();
      try {
        const fact = await getMatchFact(client, m0);
        assertCondition(fact.scoreA === 13 && fact.scoreB === 4, "B2 更正事实必须落库");
        assertCondition(await auditCount(client, "match.result.corrected", m0) === 1, "B2 更正审计恰好一条");

        // 修正后经既有 finalize 路径重建第 2 轮。
        const rebuilt = await database.transaction((tx) =>
          finalizeMajorSwissRoundInTransaction(tx, {
            seasonId: fixture.seasonId, stageRunId: run.runId, expectedRound: 1, actorId: ACTOR,
          }),
        );
        assertCondition(!rebuilt.alreadyFinalized && rebuilt.createdNextRound === 8, "B3 修正后确认第 1 轮应重建 8 场第 2 轮");
      } finally {
        client.release();
      }
    }

    // ── A / C / D / E / F / G：主 fixture ───────────────────────────────
    {
      const fixture = await prepareFixture(pool, "main-recovery");
      fixtures.push(fixture);
      const run = fixture.stageKeysWithRuns[0]!;
      const r1 = await generateAndInsertRound1(pool, fixture);
      await finishRound1Matches(pool, r1, { flipMatchIndexes: [0] });
      await database.transaction((tx) =>
        finalizeMajorSwissRoundInTransaction(tx, {
          seasonId: fixture.seasonId, stageRunId: run.runId, expectedRound: 1, actorId: ACTOR,
        }),
      );

      const client = await pool.connect();

      // A. 同胜者笔误最小更正。
      const typoTarget = r1.matchIdsByIndex[1]!;
      const typoApplied = await database.transaction((tx) =>
        applyResultCorrectionInTx(tx, {
          matchId: typoTarget,
          proposal: { scoreA: 13, scoreB: 9 },
          actorId: ACTOR,
        }),
      );
      assertCondition(!typoApplied.winnerChanged && !typoApplied.alreadyApplied, "A 同胜者笔误应为普通更正");

      // A2. 弃赛形态同胜者更正。
      await database.transaction((tx) =>
        applyResultCorrectionInTx(tx, {
          matchId: r1.matchIdsByIndex[2]!,
          proposal: { scoreA: 13, scoreB: 0, isForfeit: true },
          actorId: ACTOR,
        }),
      );
      {
        const forfeitFact = await getMatchFact(client, r1.matchIdsByIndex[2]!);
        assertCondition(forfeitFact.isForfeit, "A2 弃赛标记必须持久化");
      }

      // C. 计划层展示影响并要求显式确认。
      const m0 = r1.matchIdsByIndex[0]!;
      const plan = await database.transaction((tx) =>
        planResultCorrectionInTx(tx, { matchId: m0, proposal: { scoreA: 13, scoreB: 4 } }),
      );
      assertCondition(plan.winnerChanges, "C 计划必须识别胜者变更");
      assertCondition(plan.blockedReasons.length === 0, "C 全部下游未开始时不应有 fail-closed 理由");
      const plannedInvalidations = plan.impacts.filter((impact) => impact.kind === "downstream_match" && impact.status === "scheduled");
      assertCondition(plannedInvalidations.length === 8, "C 影响清单必须列出全部 8 场第 2 轮（配对可能涟漪重排）");
      assertCondition(plan.impacts.some((impact) => impact.kind === "stage_run_rollback"), "C 计划必须包含 finalizedRound 回滚");
      assertCondition(await auditCount(client, "match.result.corrected", m0) === 0, "C 前置状态：m0 尚无更正审计");

      await expectAppError(
        () => database.transaction((tx) =>
          applyResultCorrectionInTx(tx, { matchId: m0, proposal: { scoreA: 13, scoreB: 4 }, actorId: ACTOR }),
        ),
        ErrorCode.VALIDATION_FAILED,
        "显式确认恢复流程",
        "C1 未确认恢复必须拒绝",
      );

      const applied = await database.transaction((tx) =>
        applyResultCorrectionInTx(tx, { matchId: m0, proposal: { scoreA: 13, scoreB: 4 }, actorId: ACTOR, confirmRecovery: true }),
      );
      assertCondition(applied.winnerChanged, "C2 应用必须成功");
      assertCondition(applied.invalidatedDownstreamMatches.length === 8, "C2 应作废全部 8 场第 2 轮");
      assertCondition(applied.rolledBackToFinalized === 0, "C2 finalizedRound 应回滚到 0");
      assertCondition(await auditCount(client, "match.result.corrected", m0) === 1, "C2 更正审计恰好一条");
      assertCondition(await auditCount(client, "major.stage.finalized_round.revoked", run.runId) === 1, "C2 回滚审计恰好一条");
      assertCondition(await countManagedMatches(client, run.runId, 2) === 0, "C2 第 2 轮托管比赛应清空");
      for (const invalidated of applied.invalidatedDownstreamMatches) {
        assertCondition(await auditCount(client, "match.managed.invalidated", invalidated) === 1, "C2 每场作废必须有独立审计");
      }

      // E. 重复提交同一更正请求：alreadyApplied 且不新增审计/不再作废。
      const repeat = await database.transaction((tx) =>
        applyResultCorrectionInTx(tx, { matchId: m0, proposal: { scoreA: 13, scoreB: 4 }, actorId: ACTOR, confirmRecovery: true }),
      );
      assertCondition(repeat.alreadyApplied, "E 重复更正应 alreadyApplied");
      assertCondition(repeat.invalidatedDownstreamMatches.length === 0, "E 重复更正不得再作废任何比赛");
      assertCondition(await auditCount(client, "match.result.corrected", m0) === 1, "E 重复更正不得新增审计");

      // C3/F. 经既有 finalize 确定性重建；重复 finalize 幂等。
      const rebuilt = await database.transaction((tx) =>
        finalizeMajorSwissRoundInTransaction(tx, {
          seasonId: fixture.seasonId, stageRunId: run.runId, expectedRound: 1, actorId: ACTOR,
        }),
      );
      assertCondition(!rebuilt.alreadyFinalized && rebuilt.createdNextRound === 8, "C3 重建应重新生成 8 场第 2 轮");
      const rebuildRepeat = await database.transaction((tx) =>
        finalizeMajorSwissRoundInTransaction(tx, {
          seasonId: fixture.seasonId, stageRunId: run.runId, expectedRound: 1, actorId: ACTOR,
        }),
      );
      assertCondition(rebuildRepeat.alreadyFinalized && rebuildRepeat.createdNextRound === 0, "F 重复 finalize 幂等");
      assertCondition(await countManagedMatches(client, run.runId, 2) === 8, "C3 重建后第 2 轮仍为 8 场");

      // C4. 更正后的胜者（m0 teamA=高种子）必须真实出现在重建后的对阵中。
      {
        const m0Teams = await client.query<{ team_a_id: string; team_b_id: string; score_a: number; score_b: number }>(
          `SELECT team_a_id, team_b_id, score_a, score_b FROM matches WHERE id = $1`, [m0]);
        const restoredWinner =
          m0Teams.rows[0]!.score_a > m0Teams.rows[0]!.score_b ? m0Teams.rows[0]!.team_a_id : m0Teams.rows[0]!.team_b_id;
        const containsNewWinner = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM matches
           WHERE major_stage_run_id = $1 AND round = 2 AND (team_a_id = $2 OR team_b_id = $2)`,
          [run.runId, restoredWinner],
        );
        assertCondition(Number(containsNewWinner.rows[0]!.count) >= 1, "C4 恢复后的胜者必须出现在重建对阵中");
      }

      // D. 一场第 2 轮开始后再尝试另一场第 1 轮逆转 → hard block。
      {
        const r2Row = await client.query<{ id: string }>(
          `SELECT id FROM matches WHERE major_stage_run_id = $1 AND round = 2 LIMIT 1`, [run.runId]);
        await client.query(`UPDATE matches SET status = 'in_progress', updated_at = now() WHERE id = $1`, [r2Row.rows[0]!.id]);
        const mLast = r1.matchIdsByIndex[r1.matchIdsByIndex.length - 1]!;
        await expectAppError(
          () => database.transaction((tx) =>
            applyResultCorrectionInTx(tx, { matchId: mLast, proposal: { scoreA: 4, scoreB: 13 }, actorId: ACTOR, confirmRecovery: true }),
          ),
          ErrorCode.VALIDATION_FAILED,
          "已经开始或完成",
          "D 已开始下游必须硬阻断",
        );
        const untouched = await getMatchFact(client, mLast);
        assertCondition(untouched.scoreA === 13 && untouched.scoreB === 4, "D 阻断后原结果不变");
        assertCondition(await getFinalizedRound(client, run.runId) === 1, "D 阻断后 finalizedRound 不变");
      }

      // F. 注入官方名次事实 → 任何胜者更正被拒绝。
      {
        const finalResultCheck = await client.query<{ id: string }>(
          `INSERT INTO major_final_results (
             season_id, playoff_stage_run_id, champion_team_id, placement_groups, status, finalized_by
           )
           SELECT $1, $2, (SELECT team_id FROM major_stage_entrants WHERE stage_run_id = $2 ORDER BY stage_seed LIMIT 1), '[]'::jsonb, 'pending_confirmation', 'local-admin'
           RETURNING id`,
          [fixture.seasonId, run.runId],
        );
        assertCondition(Boolean(finalResultCheck.rows[0]?.id), "F 官方名次夹具注入成功");
        await expectAppError(
          () => database.transaction((tx) =>
            applyResultCorrectionInTx(tx, { matchId: typoTarget, proposal: { scoreA: 4, scoreB: 13 }, actorId: ACTOR, confirmRecovery: true }),
          ),
          ErrorCode.VALIDATION_FAILED,
          "官方名次已经生成",
          "F 官方名次存在时必须拒绝胜者更正",
        );
        await client.query(`DELETE FROM major_final_results WHERE season_id = $1`, [fixture.seasonId]);
      }

      // G. 后续阶段 StageRun 已建立 → 本阶段胜者更正被拒绝。
      await client.query(
        `INSERT INTO major_stage_runs (season_id, stage_key, rule_snapshot, started_by)
         SELECT r.season_id, 'stage2',
                jsonb_set(r.rule_snapshot, '{stage}', '{"key":"stage2","type":"swiss","teamCount":16,"matchFormat":"bo1"}'::jsonb),
                'local-admin'
         FROM major_stage_runs r WHERE r.id = $1`,
        [run.runId],
      );
      fixtures.at(-1)!.stageKeysWithRuns.push({ stageKey: "stage2", runId: "(via-insert)" });

      client.release();

      // 用独立 fixture 再验证一次完整阻断路径（不依赖主 fixture 内部顺序）。
      {
        const staged = await prepareFixture(pool, "post-transition");
        fixtures.push(staged);
        const stage1 = staged.stageKeysWithRuns[0]!;
        const r1Late = await generateAndInsertRound1(pool, staged);
        await finishRound1Matches(pool, r1Late, { flipMatchIndexes: [0] });
        await database.transaction((tx) =>
          finalizeMajorSwissRoundInTransaction(tx, {
            seasonId: staged.seasonId, stageRunId: stage1.runId, expectedRound: 1, actorId: ACTOR,
          }),
        );
        const separateClient = await pool.connect();
        try {
          await separateClient.query(
            `INSERT INTO major_stage_runs (season_id, stage_key, rule_snapshot, started_by)
             SELECT r.season_id, 'stage2',
                    jsonb_set(r.rule_snapshot, '{stage}', '{"key":"stage2","type":"swiss","teamCount":16,"matchFormat":"bo1"}'::jsonb),
                    'local-admin'
             FROM major_stage_runs r WHERE r.id = $1`,
            [stage1.runId],
          );
          staged.stageKeysWithRuns.push({ stageKey: "stage2", runId: "(late-marker)" });
        } finally {
          separateClient.release();
        }

        await expectAppError(
          () => database.transaction((tx) =>
            applyResultCorrectionInTx(tx, {
              matchId: r1Late.matchIdsByIndex[0]!,
              proposal: { scoreA: 13, scoreB: 4 },
              actorId: ACTOR,
              confirmRecovery: true,
            }),
          ),
          ErrorCode.VALIDATION_FAILED,
          "后续阶段",
          "G 后续阶段存在时必须拒绝胜者更正",
        );
      }
    }

    console.log("G2 result recovery integration suite passed.");
  } finally {
    for (const fixture of fixtures.reverse()) {
      await cleanupFixture(pool, fixture);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
