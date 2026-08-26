import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "../../src/db/schema";
import { startMajorInTransaction } from "../../src/lib/major/start";
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
        stage_plan, registration_config, team_registration_config, min_team_size, max_team_size, starter_count, positions
      ) VALUES ($1, $2, 'Local Major Start', 'Major', 'registration', $3, $4, $5, $6::json, $7::json, $8::json, $9, $10, $11, $12::text[])`,
      [
        seasonId, `local-major-start-${label}-${seasonId}`,
        capabilities.registrationMode, capabilities.hasCaptainVoting, capabilities.hasDraft,
        JSON.stringify(capabilities.stagePlan), JSON.stringify(capabilities.registrationConfig),
        JSON.stringify(capabilities.teamRegistrationConfig), capabilities.minTeamSize,
        capabilities.maxTeamSize, capabilities.starterCount, capabilities.positions,
      ],
    );
    await client.query(
      `INSERT INTO users (id, email) SELECT value::uuid, 'major-start-' || value || '@local.test'
       FROM unnest($1::text[]) AS value`,
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
        `INSERT INTO major_prestart_roster_members (entrant_id, user_id)
         SELECT $1, user_id FROM team_members WHERE season_id = $2 AND team_id = $3`,
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
      const started = await client.query<{ status: string; runs: string; entrants: string; matches: string; audits: string; seeds_locked: boolean; rule_snapshot: { stage?: { key?: string }; openingPairings?: unknown[] } }>(`
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
      if (facts?.status !== "playing" || facts.runs !== "1" || facts.entrants !== "16" || facts.matches !== "8" || facts.audits !== "1" || !facts.seeds_locked || facts.rule_snapshot?.stage?.key !== "stage1" || facts.rule_snapshot.openingPairings?.length !== 8) {
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
    console.log("Major start local integration passed: concurrent retry idempotency, 32-team lock, 16 StageEntrants, 8 owned R1 matches, rule snapshot path, and forced rollback.");
  } finally {
    await Promise.all(fixtures.map((fixture) => cleanupMajorFixture(pool, fixture)));
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
