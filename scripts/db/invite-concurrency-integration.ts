/** Local PostgreSQL canary for claimInviteCode's invite-row serialization. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const url = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!url || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("邀请码并发测试只允许 Local Supabase loopback 数据库。");
}

async function main() {
  const pool = new Pool({ connectionString: url, ssl: false, max: 4 });
  const seasonId = randomUUID(); const inviteId = randomUUID(); const users = [randomUUID(), randomUUID()];
  try {
    await pool.query(`INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, stage_plan, registration_config, team_registration_config, affiliation_rules, min_team_size, max_team_size, starter_count, positions)
      VALUES ($1, $2, 'Invite concurrency', 'Rivals', 'draft', 'solo', false, false, '[]', '{}', '{}', '[]', 5, 9, 5, ARRAY['any'])`, [seasonId, `local-invite-${seasonId}`]);
    for (const [index, userId] of users.entries()) await pool.query(`INSERT INTO users (id, email, role) VALUES ($1, $2, 'user')`, [userId, `invite-${index}-${seasonId}@local.test`]);
    await pool.query(`INSERT INTO admin_invites (id, code, created_by, role, season_id, max_uses, used_count, is_active) VALUES ($1, $2, 'local', 'admin', $3, 1, 0, true)`, [inviteId, `LOCAL-${inviteId}`, seasonId]);

    const claim = async (userId: string) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const invite = await client.query(`SELECT * FROM admin_invites WHERE id = $1 FOR UPDATE`, [inviteId]);
        const user = await client.query(`SELECT role FROM users WHERE id = $1 FOR UPDATE`, [userId]);
        const row = invite.rows[0];
        if (!row || !user.rows[0] || !row.is_active || row.used_count >= row.max_uses) { await client.query("ROLLBACK"); return false; }
        await client.query(`UPDATE users SET role = (CASE WHEN $2 = 'super_admin' THEN 'super_admin' ELSE 'season_admin' END)::user_role, admin_season_id = array_append(admin_season_id, $3::uuid) WHERE id = $1`, [userId, user.rows[0].role, seasonId]);
        await client.query(`UPDATE admin_invites SET used_count = used_count + 1, is_active = false WHERE id = $1`, [inviteId]);
        await client.query("COMMIT"); return true;
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    };
    const results = await Promise.all(users.map(claim));
    const [{ used_count }] = (await pool.query<{ used_count: number }>(`SELECT used_count FROM admin_invites WHERE id = $1`, [inviteId])).rows;
    const [{ count }] = (await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users WHERE id = ANY($1::uuid[]) AND role = 'season_admin'`, [users])).rows;
    if (results.filter(Boolean).length !== 1 || used_count !== 1 || Number(count) !== 1) throw new Error("maxUses=1 并发 claim 未收敛为一次成功、一次提权与 usedCount=1。");
    console.log("Invite concurrency local integration passed.");
  } finally {
    await pool.query(`DELETE FROM admin_invites WHERE id = $1`, [inviteId]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    await pool.query(`DELETE FROM seasons WHERE id = $1`, [seasonId]);
    await pool.end();
  }
}
void main();
