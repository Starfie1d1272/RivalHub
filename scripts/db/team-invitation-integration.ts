import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import { acceptTeamInvitationInTx, expirePendingInvitationsInTx } from "../../src/lib/teams/invitations";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("Team 邀请生命周期集成测试只允许 Local Supabase loopback 数据库。");
}

let checkIndex = 0;
function check(condition: boolean, message: string): void {
  checkIndex++;
  if (!condition) throw new Error(`断言失败 (#${checkIndex}): ${message}`);
}

/**
 * 长期 Team 邀请过期生命周期：过期的 pending direct 邀请必须被收敛为
 * expired（系统时间事实，不伪造 response），释放 partial unique 的 pending
 * 身份，让队长可以重新邀请同一用户；过期邀请不能形成 membership。
 */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  const ids = { captain: randomUUID(), invitee: randomUUID(), team: randomUUID(), stale: randomUUID(), fresh: randomUUID() };
  try {
    await pool.query("BEGIN");
    await pool.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [
      ids.captain, `invite-lifecycle-captain-${ids.captain}@local.test`,
      ids.invitee, `invite-lifecycle-invitee-${ids.invitee}@local.test`,
    ]);
    await pool.query(
      "INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Invite Lifecycle Team', $3, $3)",
      [ids.team, `invite-lifecycle-${ids.team.slice(0, 8)}`, ids.captain],
    );
    await pool.query(
      "INSERT INTO team_memberships (team_id, user_id, role, status, invited_by_user_id) VALUES ($1, $2, 'captain', 'active', $2)",
      [ids.team, ids.captain],
    );
    await pool.query("COMMIT");

    // stale pending：已过期的 direct 邀请仍然占用 (team, user) pending 身份。
    await pool.query(
      `INSERT INTO team_invitations (id, team_id, kind, invited_user_id, invited_by_user_id, status, expires_at, created_at, updated_at)
       VALUES ($1, $2, 'direct', $3, $4, 'pending', now() - interval '1 minute', now() - interval '8 days', now() - interval '8 days')`,
      [ids.stale, ids.team, ids.invitee, ids.captain],
    );

    // 重新邀请前的 canonical 过期收敛：旧 row → expired，且不伪造 response。
    const expiredCount = await database.transaction((tx) =>
      expirePendingInvitationsInTx(tx, { teamId: ids.team, invitedUserId: ids.invitee }),
    );
    check(expiredCount === 1, "只有过期的 pending 邀请被收敛。");
    const staleRow = await pool.query<{ status: string; responded_at: Date | null; responded_by: string | null }>(
      "SELECT status::text AS status, responded_at, responded_by_user_id AS responded_by FROM team_invitations WHERE id = $1",
      [ids.stale],
    );
    check(staleRow.rows[0]?.status === "expired", "过期 pending 邀请应持久化为 expired。");
    check(staleRow.rows[0]?.responded_at === null && staleRow.rows[0]?.responded_by === null, "过期是系统时间事实，不应伪造 response 字段。");

    // pending 身份被释放：同一 (team, user) 可以再创建新的 pending direct 邀请。
    await pool.query(
      `INSERT INTO team_invitations (id, team_id, kind, invited_user_id, invited_by_user_id, status, expires_at)
       VALUES ($1, $2, 'direct', $3, $4, 'pending', now() + interval '7 days')`,
      [ids.fresh, ids.team, ids.invitee, ids.captain],
    );
    const pendingCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM team_invitations WHERE team_id = $1 AND invited_user_id = $2 AND status = 'pending'",
      [ids.team, ids.invitee],
    );
    check(pendingCount.rows[0]?.count === "1", "过期收敛后应恰好存在一封新的 pending 邀请。");

    // 未过期的新 pending 邀请不被同一收敛误伤。
    const reExpired = await database.transaction((tx) =>
      expirePendingInvitationsInTx(tx, { teamId: ids.team, invitedUserId: ids.invitee }),
    );
    check(reExpired === 0, "未过期的 pending 邀请不应被过期收敛。");

    // accept 侧：调用 production accept transition owner。expired 必须在事务
    // 正常提交后持久化（tagged outcome，而不是写完就 throw 触发回滚）。
    await pool.query("UPDATE team_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [ids.fresh]);
    const expiredOutcome = await database.transaction((tx) =>
      acceptTeamInvitationInTx(tx, { userId: ids.invitee, actorId: ids.invitee, invitationId: ids.fresh }),
    );
    check(expiredOutcome.kind === "expired", "accept 过期邀请应返回 expired outcome。");
    const expiredRow = await pool.query<{ status: string; responded_at: Date | null; responded_by: string | null }>(
      "SELECT status::text AS status, responded_at, responded_by_user_id AS responded_by FROM team_invitations WHERE id = $1",
      [ids.fresh],
    );
    check(expiredRow.rows[0]?.status === "expired", "production accept path 应把过期邀请持久化为 expired。");
    check(expiredRow.rows[0]?.responded_at === null && expiredRow.rows[0]?.responded_by === null, "过期不应伪造 response 字段。");
    const membershipsAfterExpired = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM team_memberships WHERE team_id = $1 AND user_id = $2",
      [ids.team, ids.invitee],
    );
    check(membershipsAfterExpired.rows[0]?.count === "0", "接受过期邀请不能形成 membership。");

    // accept 成功路径同样走 production owner：pending → accepted + membership。
    const freshAcceptable = randomUUID();
    await pool.query(
      `INSERT INTO team_invitations (id, team_id, kind, invited_user_id, invited_by_user_id, status, expires_at)
       VALUES ($1, $2, 'direct', $3, $4, 'pending', now() + interval '7 days')`,
      [freshAcceptable, ids.team, ids.invitee, ids.captain],
    );
    const accepted = await database.transaction((tx) =>
      acceptTeamInvitationInTx(tx, { userId: ids.invitee, actorId: ids.invitee, invitationId: freshAcceptable }),
    );
    check(accepted.kind === "accepted", "accept 有效邀请应返回 accepted outcome。");
    if (accepted.kind !== "accepted") throw new Error("unreachable");
    const acceptedRow = await pool.query<{ status: string; memberships: string; audit: string }>(
      `SELECT (SELECT status::text FROM team_invitations WHERE id = $1) AS status,
              (SELECT count(*)::text FROM team_memberships WHERE team_id = $2 AND user_id = $3 AND status = 'active' AND ended_at IS NULL) AS memberships,
              (SELECT count(*)::text FROM audit_logs WHERE action = 'team.invite.accept' AND target_id = $2::text) AS audit`,
      [freshAcceptable, accepted.teamId, ids.invitee],
    );
    check(acceptedRow.rows[0]?.status === "accepted" && acceptedRow.rows[0]?.memberships === "1" && acceptedRow.rows[0]?.audit === "1",
      "accept 有效邀请应原子形成 membership、accepted 邀请与审计。");

    const remainingPending = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM team_invitations WHERE team_id = $1 AND status = 'pending'",
      [ids.team],
    );
    check(remainingPending.rows[0]?.count === "0", "过期收敛后不应残留 pending 邀请。");

    console.log("Team invitation lifecycle local integration passed: stale pending invite expiry, freed pending identity for re-invite, untouched fresh invites, and production accept path persisting expired outcomes without membership.");
  } finally {
    await pool.query("DELETE FROM team_invitations WHERE team_id = $1", [ids.team]);
    await pool.query("DELETE FROM team_memberships WHERE team_id = $1", [ids.team]);
    await pool.query("DELETE FROM teams WHERE id = $1", [ids.team]);
    await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [ids.captain, ids.invitee]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
