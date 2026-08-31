import { and, count, eq } from "drizzle-orm";

import type { TxDb } from "@/db/client";
import {
  adminInviteClaims,
  adminInvites,
  auditLogs,
  seasonAdminGrants,
  users,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

export type AdminInviteRole = "season_admin" | "super_admin";

export interface AdminInviteClaimResult {
  role: AdminInviteRole;
  userId: string;
  email: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Claim an administrator invite inside the caller's transaction.
 *
 * The invite row is locked before the claim count is read. All authorization
 * facts and the claim ledger are mutated in this same transaction so a
 * concurrent claim cannot exceed maxUses or partially grant access.
 */
export async function claimAdminInviteInTx(
  tx: TxDb,
  input: { code: string; userId: string },
): Promise<AdminInviteClaimResult> {
  const [invite] = await tx
    .select()
    .from(adminInvites)
    .where(eq(adminInvites.code, input.code))
    .for("update");

  if (!invite) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "邀请码无效");
  }

  const [claimCountRow] = await tx
    .select({ count: count() })
    .from(adminInviteClaims)
    .where(eq(adminInviteClaims.inviteId, invite.id));
  const claimedCount = Number(claimCountRow?.count ?? 0);

  if (!invite.isActive) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "邀请码已失效");
  }
  if (claimedCount >= invite.maxUses) {
    await tx
      .update(adminInvites)
      .set({ isActive: false })
      .where(eq(adminInvites.id, invite.id));
    throw new AppError(ErrorCode.UNAUTHORIZED, "邀请码已用完");
  }

  const [existingClaim] = await tx
    .select({ userId: adminInviteClaims.userId })
    .from(adminInviteClaims)
    .where(
      and(
        eq(adminInviteClaims.inviteId, invite.id),
        eq(adminInviteClaims.userId, input.userId),
      ),
    )
    .limit(1);
  if (existingClaim) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "该账号已经使用过此邀请码");
  }

  const [currentUser] = await tx
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .for("update");
  if (!currentUser) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "账号不存在，请重新登录后重试");
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "邀请码已过期");
  }
  if (invite.role === "season_admin" && !invite.seasonId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "赛季管理员邀请码缺少赛季范围");
  }
  if (invite.role === "super_admin" && invite.seasonId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "超级管理员邀请码不能绑定赛季范围");
  }

  let grantedByUserId: string | null = null;
  if (UUID_PATTERN.test(invite.createdBy)) {
    const [grantor] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, invite.createdBy))
      .limit(1);
    grantedByUserId = grantor?.id ?? null;
  }

  if (invite.role === "season_admin") {
    await tx
      .insert(seasonAdminGrants)
      .values({
        userId: currentUser.id,
        seasonId: invite.seasonId!,
        grantedAt: new Date(),
        grantedByUserId,
      })
      .onConflictDoNothing();
  } else {
    await tx
      .update(users)
      .set({ role: "super_admin", updatedAt: new Date() })
      .where(eq(users.id, currentUser.id));
  }

  await tx.insert(adminInviteClaims).values({
    inviteId: invite.id,
    userId: currentUser.id,
    claimedAt: new Date(),
  });

  const nextClaimCount = claimedCount + 1;
  if (nextClaimCount >= invite.maxUses) {
    await tx
      .update(adminInvites)
      .set({ isActive: false })
      .where(eq(adminInvites.id, invite.id));
  }

  await tx.insert(auditLogs).values({
    seasonId: invite.seasonId,
    action: "user.claim_invite",
    actorId: currentUser.id,
    targetId: currentUser.id,
    targetType: "user",
    meta: {
      inviteId: invite.id,
      inviteRole: invite.role,
      email: currentUser.email,
    },
  });

  return {
    role: invite.role,
    userId: currentUser.id,
    email: currentUser.email,
  };
}
