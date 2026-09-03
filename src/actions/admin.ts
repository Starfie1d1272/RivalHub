"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/db/client";
import {
  seasons,
  seasonRegistrations,
  auditLogs,
  adminInvites,
  seasonAdminGrants,
  users,
  draftPicks,
} from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError, failValidation } from "@/lib/action-utils";
import {
  auditActorId,
  requireSeasonAdmin,
  requireSuperAdmin,
} from "@/lib/auth/session";
import { normalizeRegistrationConfig } from "@/types/season";
import { maybeAdvanceFromRegistration } from "@/actions/transitions";
import {
  type RegistrationStatus,
  validateTransition,
} from "@/lib/registration-transitions";

// ── 审核报名 ────────────────────────────────────────────

interface ReviewInput {
  registrationId: string;
  status: "pending" | "approved" | "rejected" | "waitlisted";
  reason?: string;
}

export async function reviewRegistration(input: ReviewInput) {
  const { registrationId, status: targetStatus, reason } = input;

  if (!["pending", "approved", "rejected", "waitlisted"].includes(targetStatus)) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "无效的审核状态" });
  }

  try {
    const existingReg = await db.query.seasonRegistrations.findFirst({
      where: eq(seasonRegistrations.id, registrationId),
      columns: { seasonId: true },
    });
    if (!existingReg) {
      throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");
    }
    const admin = await requireSeasonAdmin(existingReg.seasonId);

    // 事务内完成状态校验 + 位置检查 + 更新 + audit_log
    await db.transaction(async (tx) => {
      const reg = await tx.query.seasonRegistrations.findFirst({
        where: eq(seasonRegistrations.id, registrationId),
      });
      if (!reg) {
        throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");
      }

      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, reg.seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      }

      validateTransition(reg.status as RegistrationStatus, targetStatus, season.status);

      if (reg.status === "approved" && targetStatus !== "approved") {
        const [pickCount] = await tx
          .select({ count: count() })
          .from(draftPicks)
          .where(eq(draftPicks.registrationId, registrationId));
        if (Number(pickCount?.count ?? 0) > 0) {
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            "该选手已被选秀选中，无法撤回审批",
          );
        }
      }

      if (targetStatus === "approved") {
        // 只统计已通过的，不含自身（自身是 pending/waitlisted，未算入上限）
        const [posCount] = await tx
          .select({ count: count() })
          .from(seasonRegistrations)
          .where(
            and(
              eq(seasonRegistrations.seasonId, reg.seasonId),
              eq(seasonRegistrations.primaryPosition, reg.primaryPosition),
              eq(seasonRegistrations.status, "approved"),
            ),
          );
        const registrationConfig = normalizeRegistrationConfig(season.registrationConfig);
        if (Number(posCount?.count ?? 0) >= registrationConfig.maxPerPosition) {
          throw new AppError(ErrorCode.POSITION_FULL, ERROR_MESSAGES.POSITION_FULL);
        }
      }

      await tx
        .update(seasonRegistrations)
        .set({ status: targetStatus, updatedAt: new Date() })
        .where(eq(seasonRegistrations.id, registrationId));

      await tx.insert(auditLogs).values({
        seasonId: reg.seasonId,
        action: `registration.${targetStatus}`,
        actorId: auditActorId(admin),
        targetId: registrationId,
        targetType: "registration",
        meta: {
          from: reg.status,
          to: targetStatus,
          reason: reason ?? null,
          primaryPosition: reg.primaryPosition,
          actorEmail: admin.email,
        },
      });

      if (targetStatus === "approved") {
        await maybeAdvanceFromRegistration(tx, reg.seasonId);
      }
    });

    // revalidatePath 放在事务外（事务成功后刷新缓存）
    const reg = await db.query.seasonRegistrations.findFirst({
      where: eq(seasonRegistrations.id, registrationId),
      columns: { seasonId: true },
    });
    const season = reg
      ? await db.query.seasons.findFirst({
          where: eq(seasons.id, reg.seasonId),
          columns: { slug: true },
        })
      : null;

    if (season) revalidatePath(`/admin/${season.slug}/registrations`);
    return ok({ id: registrationId, status: targetStatus });
  } catch (e) {
    return actionError("reviewRegistration", e);
  }
}

// ── 邀请码管理 ──────────────────────────────────────────

export async function createInviteCode(input: {
  role?: "season_admin" | "super_admin";
  seasonId?: string;
  maxUses?: number;
  expiresInHours?: number;
}) {
  const admin = await requireSuperAdmin();
  const { role = "season_admin", seasonId, maxUses = 1, expiresInHours } = input;

  if (role === "season_admin" && !seasonId) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请选择赛季范围" });
  }
  if (role === "super_admin" && seasonId) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "超级管理员邀请码不能绑定赛季范围" });
  }
  if (!Number.isInteger(maxUses) || maxUses < 1) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "使用次数必须是正整数" });
  }
  if (expiresInHours !== undefined && (!Number.isFinite(expiresInHours) || expiresInHours <= 0)) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "有效期必须是正数" });
  }
  if (role === "season_admin" && seasonId) {
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
      columns: { id: true },
    });
    if (!season) {
      return fail({ code: ErrorCode.SEASON_NOT_FOUND, message: ERROR_MESSAGES.SEASON_NOT_FOUND });
    }
  }
  const code = randomBytes(8).toString("hex");

  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 3600_000)
    : null;
  const inviteSeasonId = role === "season_admin" ? seasonId! : null;

  const invite = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(adminInvites)
      .values({
        code,
        createdBy: auditActorId(admin),
        role,
        seasonId: inviteSeasonId,
        maxUses,
        expiresAt,
      })
      .returning({ id: adminInvites.id });
    if (!created) throw new Error("邀请码创建失败");

    await tx.insert(auditLogs).values({
      seasonId: inviteSeasonId,
      action: "admin.create_invite",
      actorId: auditActorId(admin),
      targetId: created.id,
      targetType: "admin_invite",
      meta: { role, maxUses, expiresAt: expiresAt?.toISOString() ?? null },
    });
    return created;
  });

  revalidatePath("/admin/invites");
  return ok({
    id: invite.id,
    code,
    role,
    seasonId: inviteSeasonId,
    maxUses,
    expiresAt: expiresAt?.toISOString() ?? null,
  });
}

export async function deactivateInviteCode(inviteId: string) {
  const admin = await requireSuperAdmin();

  await db.transaction(async (tx) => {
    const [invite] = await tx
      .select({ id: adminInvites.id, seasonId: adminInvites.seasonId })
      .from(adminInvites)
      .where(eq(adminInvites.id, inviteId))
      .for("update");
    if (!invite) throw new AppError(ErrorCode.NOT_FOUND, "邀请码不存在");

    await tx
      .update(adminInvites)
      .set({ isActive: false })
      .where(eq(adminInvites.id, inviteId));

    await tx.insert(auditLogs).values({
      seasonId: invite.seasonId,
      action: "admin.deactivate_invite",
      actorId: auditActorId(admin),
      targetId: inviteId,
      targetType: "admin_invite",
    });
  });

  revalidatePath("/admin/invites");
  return ok(undefined);
}

// ── 撤销用户管理员权限 ─────────────────────────────────────

export async function revokeUserAdminRole(userId: string) {
  try {
    const session = await requireSuperAdmin();

    if (userId === session.userId) {
      return failValidation("不能撤销自己的权限");
    }

    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!target) {
        throw new AppError(ErrorCode.NOT_FOUND, "用户不存在");
      }

      const grants = await tx
        .select({ seasonId: seasonAdminGrants.seasonId })
        .from(seasonAdminGrants)
        .where(eq(seasonAdminGrants.userId, userId));

      await tx
        .delete(seasonAdminGrants)
        .where(eq(seasonAdminGrants.userId, userId));
      await tx
        .update(users)
        .set({ role: "user", updatedAt: new Date() })
        .where(eq(users.id, userId));

      await tx.insert(auditLogs).values({
        seasonId: null,
        action: "admin.revoke_role",
        actorId: auditActorId(session),
        targetId: userId,
        targetType: "user",
        meta: { from: target.role, seasonIds: grants.map((grant) => grant.seasonId) },
      });
    });

    revalidatePath("/admin/users");
    return ok(undefined);
  } catch (e) {
    return actionError("revokeUserAdminRole", e);
  }
}
