import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("Team Registration 集成测试只允许 Local Supabase loopback 数据库。");
}

const ids = {
  season: randomUUID(),
  captain: randomUUID(),
  member: randomUUID(),
  application: randomUUID(),
  captainMember: randomUUID(),
  invitedMember: randomUUID(),
  team: randomUUID(),
};

let savepointCount = 0;

async function expectPgError(client: import("pg").PoolClient, work: () => Promise<unknown>, code: string): Promise<void> {
  const savepoint = `expected_error_${savepointCount++}`;
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
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, email, student_id) VALUES ($1, $2, $3), ($4, $5, $6)`,
      [ids.captain, `captain-${ids.captain}@local.test`, "20260001", ids.member, `member-${ids.member}@local.test`, "20260002"],
    );
    await client.query(
      `INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size, team_registration_config)
       VALUES ($1, $2, 'Local Team Registration', 'Major', 'registration', 'team', false, false, 2, 4, $3::json)`,
      [ids.season, `local-team-registration-${ids.season}`, JSON.stringify({ allowExternal: false, minHomeMembers: 2, maxExternalMembers: 0, requireTeamLogo: false })],
    );
    await client.query(
      `INSERT INTO team_applications (id, season_id, name, captain_user_id, status)
       VALUES ($1, $2, 'Application Only', $3, 'draft')`,
      [ids.application, ids.season, ids.captain],
    );
    await client.query(
      `INSERT INTO team_application_members (id, application_id, user_id, invited_by_user_id, status, confirmed_at)
       VALUES ($1, $2, $3, $3, 'confirmed', now()), ($4, $2, $5, $3, 'invited', null)`,
      [ids.captainMember, ids.application, ids.captain, ids.invitedMember, ids.member],
    );
    const before = await client.query<{ count: string }>("SELECT count(*) FROM teams WHERE team_application_id = $1", [ids.application]);
    if (before.rows[0]?.count !== "0") throw new Error("报名申请在审核前错误生成了正式队伍。");

    await client.query("UPDATE team_application_members SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [ids.invitedMember]);
    await client.query(
      `INSERT INTO teams (id, season_id, name, captain_user_id, team_application_id)
       VALUES ($1, $2, 'Application Only', $3, $4)`,
      [ids.team, ids.season, ids.captain, ids.application],
    );
    await client.query(
      `INSERT INTO team_members (team_id, season_id, user_id, team_application_member_id)
       VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)`,
      [ids.team, ids.season, ids.captain, ids.captainMember, ids.member, ids.invitedMember],
    );
    const materialized = await client.query<{ members: string }>("SELECT count(*) AS members FROM team_members WHERE team_id = $1", [ids.team]);
    if (materialized.rows[0]?.members !== "2") throw new Error("批准后未生成完整 canonical team_members 名单。");
    await expectPgError(client,
      () => client.query(
        `INSERT INTO teams (season_id, name, captain_user_id, team_application_id) VALUES ($1, 'Duplicate', $2, $3)`,
        [ids.season, ids.captain, ids.application],
      ),
      "23505",
    );
    await expectPgError(client,
      () => client.query(
        `INSERT INTO teams (season_id, name, captain_user_id) VALUES ($1, 'No provenance', $2)`,
        [ids.season, ids.captain],
      ),
      "23514",
    );

    await client.query("SET LOCAL ROLE authenticated");
    await expectPgError(client,
      () => client.query("SELECT id FROM team_applications LIMIT 1"),
      "42501",
    );
    await client.query("RESET ROLE");
    await client.query("ROLLBACK");
    console.log("Team Registration local integration passed: application boundary, canonical materialization, idempotency constraint, and RLS denial.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
