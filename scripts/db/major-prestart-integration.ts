import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("Major 赛前集成测试只允许 Local Supabase loopback 数据库。");
}

let expectedErrorIndex = 0;

async function expectPgError(client: import("pg").PoolClient, work: () => Promise<unknown>, code: string): Promise<void> {
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

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  const client = await pool.connect();
  const seasonId = randomUUID();
  const teamIds = Array.from({ length: 32 }, () => randomUUID());
  const applicationIds = Array.from({ length: 32 }, () => randomUUID());
  const userIds = Array.from({ length: 160 }, () => randomUUID());
  const memberIds = Array.from({ length: 160 }, () => randomUUID());
  const entrantId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO seasons (id, slug, name, kind, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size)
       VALUES ($1, $2, 'Local Major Prestart', 'Major', 'team', false, false, 5, 7)`,
      [seasonId, `local-major-prestart-${seasonId}`],
    );
    await client.query(
      `INSERT INTO users (id, email) SELECT value::uuid, 'prestart-' || value || '@local.test'
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
        const memberId = memberIds[index * 5 + offset];
        await client.query(
          `INSERT INTO team_application_members (id, application_id, user_id, invited_by_user_id, status, confirmed_at)
           VALUES ($1, $2, $3, $4, 'confirmed', now())`,
          [memberId, applicationIds[index], userId, userIds[index * 5]],
        );
        await client.query(
          `INSERT INTO team_members (team_id, season_id, user_id, team_application_member_id)
           VALUES ($1, $2, $3, $4)`,
          [teamIds[index], seasonId, userId, memberId],
        );
      }
    }
    await client.query("INSERT INTO major_prestart_states (season_id) VALUES ($1)", [seasonId]);
    await client.query(
      "INSERT INTO major_prestart_entrants (id, season_id, team_id) VALUES ($1, $2, $3)",
      [entrantId, seasonId, teamIds[0]],
    );
    await client.query(
      "INSERT INTO major_prestart_roster_members (entrant_id, user_id) SELECT $1, unnest($2::uuid[])",
      [entrantId, userIds.slice(0, 5)],
    );
    await expectPgError(client, () => client.query(
      "INSERT INTO major_prestart_entrants (season_id, team_id) VALUES ($1, $2)", [seasonId, teamIds[0]],
    ), "23505");
    await expectPgError(client, () => client.query(
      "INSERT INTO major_prestart_roster_members (entrant_id, user_id) VALUES ($1, $2)", [entrantId, userIds[0]],
    ), "23505");
    const before = await client.query<{ selected: string; total: string }>(`
      SELECT
        (SELECT count(*) FROM major_prestart_entrants WHERE season_id = $1) AS selected,
        (SELECT count(*) FROM teams WHERE season_id = $1) AS total
    `, [seasonId]);
    if (before.rows[0]?.selected !== "1" || before.rows[0]?.total !== "32") {
      throw new Error("正式参赛队集合没有与所有正式 teams 保持分离。");
    }
    await client.query(
      "INSERT INTO major_prestart_issues (season_id, category, label) VALUES ($1, 'qualification', '资格材料复核'), ($1, 'administration', '裁判排班')",
      [seasonId],
    );
    const issues = await client.query<{ qualification: string; administration: string }>(`
      SELECT
        count(*) FILTER (WHERE category = 'qualification' AND resolved_at IS NULL) AS qualification,
        count(*) FILTER (WHERE category = 'administration' AND resolved_at IS NULL) AS administration
      FROM major_prestart_issues WHERE season_id = $1
    `, [seasonId]);
    if (issues.rows[0]?.qualification !== "1" || issues.rows[0]?.administration !== "1") {
      throw new Error("资格与管理事项未按持久化类别保存。");
    }
    await client.query("DELETE FROM major_prestart_entrants WHERE id = $1", [entrantId]);
    const rosterAfterDelete = await client.query<{ count: string }>(
      "SELECT count(*) FROM major_prestart_roster_members WHERE entrant_id = $1", [entrantId],
    );
    if (rosterAfterDelete.rows[0]?.count !== "0") throw new Error("最终名单快照没有随正式参赛队级联删除。");
    await client.query("ROLLBACK");
    console.log("Major prestart local integration passed: selected entrants, final rosters, issue categories, uniqueness, and cascade boundary.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
