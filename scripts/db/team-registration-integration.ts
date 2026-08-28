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
  // The baseline assertion connection plus the two racing transactions still
  // need one independent reader for post-commit facts.
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
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
    await exerciseActiveClaimConcurrency(pool);
    console.log("Team Registration local integration passed: application boundary, canonical materialization, RLS denial, and two-connection active-claim races.");
  } finally {
    client.release();
    await pool.end();
  }
}

async function exerciseActiveClaimConcurrency(pool: Pool): Promise<void> {
  const seasonId = randomUUID();
  const sharedUserId = randomUUID();
  const captainAId = randomUUID();
  const captainBId = randomUUID();
  const applicationAId = randomUUID();
  const applicationBId = randomUUID();
  const setup = await pool.connect();
  try {
    await setup.query("BEGIN");
    await setup.query(
      `INSERT INTO users (id, email) VALUES
       ($1, $2), ($3, $4), ($5, $6)`,
      [sharedUserId, `shared-${sharedUserId}@local.test`, captainAId, `captain-a-${captainAId}@local.test`, captainBId, `captain-b-${captainBId}@local.test`],
    );
    await setup.query(
      `INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size)
       VALUES ($1, $2, 'Local Active Claim Race', 'Local', 'registration', 'team', false, false, 2, 5)`,
      [seasonId, `local-active-claim-${seasonId}`],
    );
    await setup.query(
      `INSERT INTO team_applications (id, season_id, name, captain_user_id, status) VALUES
       ($1, $2, 'Race A', $3, 'draft'), ($4, $2, 'Race B', $5, 'draft')`,
      [applicationAId, seasonId, captainAId, applicationBId, captainBId],
    );
    await setup.query("COMMIT");
  } catch (error) {
    await setup.query("ROLLBACK");
    throw error;
  } finally {
    setup.release();
  }

  const a = await pool.connect();
  const b = await pool.connect();
  try {
    // This is the exact transactional write order in inviteTeamApplicationMember:
    // claim first, then create the invitation. Two independent PostgreSQL
    // connections prove the unique claim converges under a real conflict.
    await a.query("BEGIN");
    const aClaim = await a.query(
      `INSERT INTO team_application_active_claims (season_id, user_id, application_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING application_id`,
      [seasonId, sharedUserId, applicationAId],
    );
    if (aClaim.rows.length !== 1) throw new Error("并发邀请前的第一条 active claim 未写入。 ");
    await a.query(
      `INSERT INTO team_application_members (application_id, user_id, invited_by_user_id)
       VALUES ($1, $2, $3)`,
      [applicationAId, sharedUserId, captainAId],
    );

    await b.query("BEGIN");
    const bClaimPromise = b.query(
      `INSERT INTO team_application_active_claims (season_id, user_id, application_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING application_id`,
      [seasonId, sharedUserId, applicationBId],
    );
    await a.query("SELECT pg_sleep(0.05)");
    await a.query("COMMIT");
    const bClaim = await bClaimPromise;
    if (bClaim.rows.length !== 0) throw new Error("并发邀请允许同一用户获得第二个 active claim。 ");
    await b.query("COMMIT");

    const firstRace = await pool.query<{ claims: string; memberships: string }>(`
      SELECT
        (SELECT count(*) FROM team_application_active_claims WHERE season_id = $1 AND user_id = $2) AS claims,
        (SELECT count(*) FROM team_application_members WHERE user_id = $2) AS memberships
    `, [seasonId, sharedUserId]);
    if (firstRace.rows[0]?.claims !== "1" || firstRace.rows[0]?.memberships !== "1") {
      throw new Error("并发邀请后出现双 active membership。 ");
    }

    // A rejected application releases its claim but retains its complete
    // history. It is not made active before its members reclaim their slots.
    // B now takes the released claim; A's later resubmit/reclaim must fail and
    // leave the application rejected.
    await pool.query("UPDATE team_applications SET status = 'rejected' WHERE id = $1", [applicationAId]);
    await pool.query("DELETE FROM team_application_active_claims WHERE application_id = $1", [applicationAId]);

    await b.query("BEGIN");
    const bRetry = await b.query(
      `INSERT INTO team_application_active_claims (season_id, user_id, application_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING application_id`,
      [seasonId, sharedUserId, applicationBId],
    );
    if (bRetry.rows.length !== 1) throw new Error("rejected 后另一申请未能取得新的 active claim。 ");
    await b.query(
      `INSERT INTO team_application_members (application_id, user_id, invited_by_user_id)
       VALUES ($1, $2, $3)`,
      [applicationBId, sharedUserId, captainBId],
    );

    await a.query("BEGIN");
    const aResubmitReclaimPromise = a.query(
      `INSERT INTO team_application_active_claims (season_id, user_id, application_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING application_id`,
      [seasonId, sharedUserId, applicationAId],
    );
    await b.query("SELECT pg_sleep(0.05)");
    await b.query("COMMIT");
    const aResubmitReclaim = await aResubmitReclaimPromise;
    if (aResubmitReclaim.rows.length !== 0) throw new Error("rejected→resubmit 与另一邀请竞争时产生第二个 active claim。 ");
    await a.query("ROLLBACK");

    const finalFacts = await pool.query<{ claims: string; active_memberships: string; claim_application: string; application_a_status: string }>(`
      SELECT
        (SELECT count(*) FROM team_application_active_claims WHERE season_id = $1 AND user_id = $2) AS claims,
        (SELECT count(*) FROM team_application_members m
          INNER JOIN team_applications a ON a.id = m.application_id
          WHERE m.user_id = $2 AND a.season_id = $1 AND a.status IN ('draft', 'submitted', 'waitlisted')) AS active_memberships,
        (SELECT application_id::text FROM team_application_active_claims WHERE season_id = $1 AND user_id = $2) AS claim_application,
        (SELECT status::text FROM team_applications WHERE id = $3) AS application_a_status
    `, [seasonId, sharedUserId, applicationAId]);
    if (finalFacts.rows[0]?.claims !== "1" || finalFacts.rows[0]?.active_memberships !== "1" || finalFacts.rows[0]?.claim_application !== applicationBId || finalFacts.rows[0]?.application_a_status !== "rejected") {
      throw new Error("真实 PostgreSQL 并发路径未收敛到唯一有效报名归属。 ");
    }
  } finally {
    try { await a.query("ROLLBACK"); } catch { /* transaction may already be closed */ }
    try { await b.query("ROLLBACK"); } catch { /* transaction may already be closed */ }
    a.release();
    b.release();
    await pool.query("DELETE FROM team_application_active_claims WHERE season_id = $1", [seasonId]);
    await pool.query(`DELETE FROM team_application_members m USING team_applications a WHERE m.application_id = a.id AND a.season_id = $1`, [seasonId]);
    await pool.query("DELETE FROM team_applications WHERE season_id = $1", [seasonId]);
    await pool.query("DELETE FROM seasons WHERE id = $1", [seasonId]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[sharedUserId, captainAId, captainBId]]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
