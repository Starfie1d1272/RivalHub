import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { acceptTeamInvitationInTx, expirePendingInvitationsInTx } from "../../../src/lib/teams/invitations";
import { createTeamShareInvitationInTx, hashTeamInvitationToken, revokeTeamInvitationInTx } from "../../../src/lib/teams/commands";
import { ErrorCode } from "../../../src/lib/errors";
import { localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

/**
 * 长期 Team 邀请过期生命周期：过期的 pending direct 邀请必须被收敛为
 * expired（系统时间事实，不伪造 response），释放 partial unique 的 pending
 * 身份，让队长可以重新邀请同一用户；过期邀请不能形成 membership。
 */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 4 });
  const database = drizzle(pool, { schema });
  const ids = { captain: randomUUID(), invitee: randomUUID(), shareInvitee: randomUUID(), team: randomUUID(), stale: randomUUID(), fresh: randomUUID() };
  try {
    await pool.query("BEGIN");
    await pool.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)", [
      ids.captain, `invite-lifecycle-captain-${ids.captain}@local.test`,
      ids.invitee, `invite-lifecycle-invitee-${ids.invitee}@local.test`,
      ids.shareInvitee, `invite-lifecycle-share-${ids.shareInvitee}@local.test`,
    ]);
    await pool.query(
      "INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Invite Lifecycle Team', $3, $3)",
      [ids.team, `invite-lifecycle-${ids.team.slice(0, 8)}`, ids.captain],
    );
    await pool.query(
      "INSERT INTO team_memberships (team_id, user_id, status, invited_by_user_id) VALUES ($1, $2, 'active', $2)",
      [ids.team, ids.captain],
    );
    await pool.query(
      "INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-test')",
      [ids.team, ids.captain],
    );
    await pool.query(
      "INSERT INTO team_name_changes (team_id, old_name, new_name, changed_by_actor_id) VALUES ($1, NULL, 'Invite Lifecycle Team', 'local-test')",
      [ids.team],
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
    expect(expiredCount === 1,  "只有过期的 pending 邀请被收敛。").toBe(true);
    const staleRow = await pool.query<{ status: string; responded_at: Date | null; responded_by: string | null }>(
      "SELECT status::text AS status, responded_at, responded_by_user_id AS responded_by FROM team_invitations WHERE id = $1",
      [ids.stale],
    );
    expect(staleRow.rows[0]?.status === "expired",  "过期 pending 邀请应持久化为 expired。").toBe(true);
    expect(staleRow.rows[0]?.responded_at === null && staleRow.rows[0]?.responded_by === null,  "过期是系统时间事实，不应伪造 response 字段。").toBe(true);

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
    expect(pendingCount.rows[0]?.count === "1",  "过期收敛后应恰好存在一封新的 pending 邀请。").toBe(true);

    // 未过期的新 pending 邀请不被同一收敛误伤。
    const reExpired = await database.transaction((tx) =>
      expirePendingInvitationsInTx(tx, { teamId: ids.team, invitedUserId: ids.invitee }),
    );
    expect(reExpired === 0,  "未过期的 pending 邀请不应被过期收敛。").toBe(true);

    // accept 侧：调用 production accept transition owner。expired 必须在事务
    // 正常提交后持久化（tagged outcome，而不是写完就 throw 触发回滚）。
    await pool.query("UPDATE team_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [ids.fresh]);
    const expiredOutcome = await database.transaction((tx) =>
      acceptTeamInvitationInTx(tx, { userId: ids.invitee, actorId: ids.invitee, invitationId: ids.fresh }),
    );
    expect(expiredOutcome.kind === "expired",  "accept 过期邀请应返回 expired outcome。").toBe(true);
    const expiredRow = await pool.query<{ status: string; responded_at: Date | null; responded_by: string | null }>(
      "SELECT status::text AS status, responded_at, responded_by_user_id AS responded_by FROM team_invitations WHERE id = $1",
      [ids.fresh],
    );
    expect(expiredRow.rows[0]?.status === "expired",  "production accept path 应把过期邀请持久化为 expired。").toBe(true);
    expect(expiredRow.rows[0]?.responded_at === null && expiredRow.rows[0]?.responded_by === null,  "过期不应伪造 response 字段。").toBe(true);
    const membershipsAfterExpired = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM team_memberships WHERE team_id = $1 AND user_id = $2",
      [ids.team, ids.invitee],
    );
    expect(membershipsAfterExpired.rows[0]?.count === "0",  "接受过期邀请不能形成 membership。").toBe(true);

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
    expect(accepted.kind === "accepted",  "accept 有效邀请应返回 accepted outcome。").toBe(true);
    if (accepted.kind !== "accepted") throw new Error("unreachable");
    const acceptedRow = await pool.query<{ status: string; memberships: string; audit: string }>(
      `SELECT (SELECT status::text FROM team_invitations WHERE id = $1) AS status,
              (SELECT count(*)::text FROM team_memberships WHERE team_id = $2 AND user_id = $3 AND status = 'active' AND ended_at IS NULL) AS memberships,
              (SELECT count(*)::text FROM audit_logs WHERE action = 'team.invite.accept' AND target_id = $2::text) AS audit`,
      [freshAcceptable, accepted.teamId, ids.invitee],
    );
    expect(acceptedRow.rows[0]?.status === "accepted" && acceptedRow.rows[0]?.memberships === "1" && acceptedRow.rows[0]?.audit === "1",
      "accept 有效邀请应原子形成 membership、accepted 邀请与审计。").toBe(true);

    const remainingPending = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM team_invitations WHERE team_id = $1 AND status = 'pending'",
      [ids.team],
    );
    expect(remainingPending.rows[0]?.count === "0",  "过期收敛后不应残留 pending 邀请。").toBe(true);

    // share_link：第一次接受形成 membership，第二次使用同一 token 只能命中
    // 已终态的 invitation，不能重复入队或重新消费链接。
    const share = await database.transaction((tx) => createTeamShareInvitationInTx(tx, { teamId: ids.team, userId: ids.captain, actorId: ids.captain }));
    const acceptedShare = await database.transaction((tx) => acceptTeamInvitationInTx(tx, {
      userId: ids.shareInvitee,
      actorId: ids.shareInvitee,
      tokenHash: hashTeamInvitationToken(share.token),
    }));
    expect(acceptedShare.kind === "accepted", "share link 第一次接受应直接形成 Team membership。").toBe(true);
    if (acceptedShare.kind !== "accepted") throw new Error("share link accept did not succeed");
    const shareAcceptedState = await pool.query<{ status: string; memberships: string }>(
      "SELECT (SELECT status::text FROM team_invitations WHERE token_hash = $1) AS status, (SELECT count(*)::text FROM team_memberships WHERE team_id = $2 AND user_id = $3 AND ended_at IS NULL) AS memberships",
      [hashTeamInvitationToken(share.token), ids.team, ids.shareInvitee],
    );
    expect(shareAcceptedState.rows[0]?.status === "accepted" && shareAcceptedState.rows[0]?.memberships === "1", "share link 接受应原子收敛为 accepted + membership。").toBe(true);
    await expect(database.transaction((tx) => acceptTeamInvitationInTx(tx, {
      userId: ids.shareInvitee,
      actorId: ids.shareInvitee,
      tokenHash: hashTeamInvitationToken(share.token),
    }))).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    // share_link 的过期仍由 canonical accept transition 持久化为 expired，
    // 不伪造响应事实，也不能形成 membership。
    const expiredShare = await database.transaction((tx) => createTeamShareInvitationInTx(tx, { teamId: ids.team, userId: ids.captain, actorId: ids.captain }));
    await pool.query("UPDATE team_invitations SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [hashTeamInvitationToken(expiredShare.token)]);
    const expiredShareOutcome = await database.transaction((tx) => acceptTeamInvitationInTx(tx, {
      userId: ids.invitee,
      actorId: ids.invitee,
      tokenHash: hashTeamInvitationToken(expiredShare.token),
    }));
    expect(expiredShareOutcome.kind === "expired", "过期 share link 应返回 expired outcome。").toBe(true);
    const expiredShareState = await pool.query<{ status: string; responded_at: Date | null; responded_by: string | null }>(
      "SELECT status::text AS status, responded_at, responded_by_user_id AS responded_by FROM team_invitations WHERE token_hash = $1",
      [hashTeamInvitationToken(expiredShare.token)],
    );
    expect(expiredShareState.rows[0]?.status === "expired" && expiredShareState.rows[0]?.responded_at === null && expiredShareState.rows[0]?.responded_by === null, "过期 share link 不应伪造 response 字段。").toBe(true);

    // captain revoke：被撤销的 pending share link 不能再被接受。
    const revokedShare = await database.transaction((tx) => createTeamShareInvitationInTx(tx, { teamId: ids.team, userId: ids.captain, actorId: ids.captain }));
    const revokedInvitation = await pool.query<{ id: string }>("SELECT id FROM team_invitations WHERE token_hash = $1", [hashTeamInvitationToken(revokedShare.token)]);
    const revokedId = revokedInvitation.rows[0]?.id;
    if (!revokedId) throw new Error("could not find created share invitation");
    await database.transaction((tx) => revokeTeamInvitationInTx(tx, { teamId: ids.team, invitationId: revokedId, userId: ids.captain, actorId: ids.captain }));
    await expect(database.transaction((tx) => acceptTeamInvitationInTx(tx, {
      userId: ids.invitee,
      actorId: ids.invitee,
      tokenHash: hashTeamInvitationToken(revokedShare.token),
    }))).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    const revokedState = await pool.query<{ status: string }>("SELECT status::text AS status FROM team_invitations WHERE id = $1", [revokedId]);
    expect(revokedState.rows[0]?.status).toBe("revoked");

    console.log("Team invitation lifecycle local integration passed: direct/share expiry, single-use share links, captain revoke, freed pending identity for re-invite, and production accept path persisting expired outcomes without membership.");
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query("SET LOCAL session_replication_role = replica");
      await cleanup.query("DELETE FROM team_invitations WHERE team_id = $1", [ids.team]);
      await cleanup.query("DELETE FROM team_captain_changes WHERE team_id = $1", [ids.team]);
      await cleanup.query("DELETE FROM team_name_changes WHERE team_id = $1", [ids.team]);
      await cleanup.query("DELETE FROM team_memberships WHERE team_id = $1", [ids.team]);
      await cleanup.query("DELETE FROM teams WHERE id = $1", [ids.team]);
      await cleanup.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [ids.captain, ids.invitee, ids.shareInvitee]);
      await cleanup.query("COMMIT");
    } catch (error) {
      await cleanup.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      cleanup.release();
    }
    await pool.end();
  }
}

describe("team invitation PostgreSQL invariants", () => {
  it("expires stale invitations and keeps acceptance idempotent", async () => {
    await main();
  });
});
