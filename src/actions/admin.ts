"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { eq, and, count, inArray, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, seasonRegistrations, auditLogs, adminUsers, adminInvites } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireAdmin, getAdminSession } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/utils/password";
import { MAX_PER_POSITION } from "@/lib/validators/registration";

// ── 状态迁移合法性校验 ────────────────────────────────────

type RegistrationStatus = "pending" | "approved" | "rejected" | "waitlisted";

function validateTransition(
  current: RegistrationStatus,
  target: RegistrationStatus,
  seasonStatus: string,
): void {
  const forbidden: Record<RegistrationStatus, RegistrationStatus[]> = {
    pending: [],
    waitlisted: [],
    approved: ["pending"],
    rejected: ["pending"],
  };
  const blocked = forbidden[current];
  if (blocked?.includes(target)) {
    throw new AppError(
      ErrorCode.REGISTRATION_INVALID_TRANSITION,
      `不允许从 ${current} 变更为 ${target}`,
    );
  }

  // (current, target) → 赛季条件
  if (current === "pending") {
    if ((target === "approved" || target === "waitlisted") && seasonStatus !== "registration") {
      if (!(target === "approved" && seasonStatus === "voting")) {
        throw new AppError(
          ErrorCode.SEASON_INVALID_STATUS,
          `当前赛季状态不允许此操作（${seasonStatus}）`,
        );
      }
    }
  }
  if (current === "waitlisted" && target === "approved") {
    if (seasonStatus !== "registration" && seasonStatus !== "voting") {
      throw new AppError(
        ErrorCode.SEASON_INVALID_STATUS,
        `当前赛季状态不允许此操作（${seasonStatus}）`,
      );
    }
  }
  if (current === "approved" && target === "rejected") {
    if (seasonStatus !== "registration") {
      throw new AppError(
        ErrorCode.SEASON_INVALID_STATUS,
        `已进入 ${seasonStatus} 阶段，不允许撤销已通过的报名`,
      );
    }
  }
  if (current === "rejected" && target === "approved") {
    if (seasonStatus !== "registration") {
      throw new AppError(
        ErrorCode.SEASON_INVALID_STATUS,
        `当前赛季状态不允许此操作（${seasonStatus}）`,
      );
    }
  }

  const allowed: Record<RegistrationStatus, RegistrationStatus[]> = {
    pending: ["approved", "rejected", "waitlisted"],
    waitlisted: ["approved", "rejected"],
    approved: ["rejected"],
    rejected: ["approved"],
  };
  if (!allowed[current]?.includes(target)) {
    throw new AppError(
      ErrorCode.REGISTRATION_INVALID_TRANSITION,
      `不允许从 ${current} 变更为 ${target}`,
    );
  }
}

// ── 管理员登录 ──────────────────────────────────────────

export async function adminLogin(username: string, password: string) {
  if (!username || !password) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请输入用户名和密码" });
  }

  const user = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.username, username),
  });
  if (!user) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "用户名或密码错误" });
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "用户名或密码错误" });
  }

  const session = await getAdminSession();
  session.isAdmin = true;
  session.adminId = user.id;
  session.adminUsername = user.username;
  session.adminRole = user.role;
  await session.save();

  redirect("/admin");
}

// ── 管理员注册（需有效邀请码）───────────────────────────

export async function registerAdmin(
  username: string,
  password: string,
  inviteCode: string,
) {
  if (!username || username.length < 3) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "用户名至少 3 个字符" });
  }
  if (!password || password.length < 8) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "密码至少 8 个字符" });
  }

  // 检查邀请码
  const invite = await db.query.adminInvites.findFirst({
    where: eq(adminInvites.code, inviteCode),
  });
  if (!invite) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "邀请码无效" });
  }
  if (!invite.isActive) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "邀请码已失效" });
  }
  if (invite.usedCount >= invite.maxUses) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "邀请码已用完" });
  }
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "邀请码已过期" });
  }

  // 检查用户名是否已存在
  const existing = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.username, username),
  });
  if (existing) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "用户名已被使用" });
  }

  // 创建管理员账户
  const [newAdmin] = await db
    .insert(adminUsers)
    .values({
      username,
      passwordHash: hashPassword(password),
      role: invite.role,
    })
    .returning();

  // 更新邀请码使用次数
  await db
    .update(adminInvites)
    .set({
      usedCount: invite.usedCount + 1,
      isActive: invite.usedCount + 1 >= invite.maxUses ? false : invite.isActive,
    })
    .where(eq(adminInvites.id, invite.id));

  // 自动登录
  const session = await getAdminSession();
  session.isAdmin = true;
  session.adminId = newAdmin.id;
  session.adminUsername = newAdmin.username;
  session.adminRole = newAdmin.role;
  await session.save();

  redirect("/admin");
}

// ── 审核报名 ────────────────────────────────────────────

interface ReviewInput {
  registrationId: string;
  status: "approved" | "rejected" | "waitlisted";
  reason?: string;
}

export async function reviewRegistration(input: ReviewInput) {
  const admin = await requireAdmin();

  const { registrationId, status: targetStatus, reason } = input;

  if (!["approved", "rejected", "waitlisted"].includes(targetStatus)) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "无效的审核状态" });
  }

  try {
    const reg = await db.query.seasonRegistrations.findFirst({
      where: eq(seasonRegistrations.id, registrationId),
    });
    if (!reg) {
      throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");
    }

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, reg.seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }

    validateTransition(reg.status as RegistrationStatus, targetStatus, season.status);

    if (targetStatus === "approved") {
      const [posCount] = await db
        .select({ count: count() })
        .from(seasonRegistrations)
        .where(
          and(
            eq(seasonRegistrations.seasonId, reg.seasonId),
            eq(seasonRegistrations.primaryPosition, reg.primaryPosition),
            inArray(seasonRegistrations.status, ["pending", "approved"]),
          ),
        );
      if (Number(posCount?.count ?? 0) >= MAX_PER_POSITION) {
        throw new AppError(ErrorCode.POSITION_FULL, ERROR_MESSAGES.POSITION_FULL);
      }
    }

    await db
      .update(seasonRegistrations)
      .set({ status: targetStatus, updatedAt: new Date() })
      .where(eq(seasonRegistrations.id, registrationId));

    await db.insert(auditLogs).values({
      seasonId: reg.seasonId,
      action: `registration.${targetStatus}`,
      actorId: admin.adminUsername ?? "admin",
      targetId: registrationId,
      targetType: "registration",
      meta: {
        from: reg.status,
        to: targetStatus,
        reason: reason ?? null,
        primaryPosition: reg.primaryPosition,
      },
    });

    revalidatePath(`/admin/${season.slug}/registrations`);
    return ok({ id: registrationId, status: targetStatus });
  } catch (e) {
    if (e instanceof AppError) {
      return fail({ code: e.code, message: e.message });
    }
    console.error("[reviewRegistration]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

// ── 邀请码管理 ──────────────────────────────────────────

export async function createInviteCode(input: {
  role?: "admin" | "super_admin";
  maxUses?: number;
  expiresInHours?: number;
}) {
  await requireAdmin();

  const { role = "admin", maxUses = 1, expiresInHours } = input;
  const code = randomBytes(8).toString("hex");

  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 3600_000)
    : null;

  await db.insert(adminInvites).values({
    code,
    createdBy: (await requireAdmin()).adminId!,
    role,
    maxUses,
    expiresAt,
  });

  revalidatePath("/admin/invites");
  return ok({ code, role, maxUses, expiresAt: expiresAt?.toISOString() ?? null });
}

export async function deactivateInviteCode(inviteId: string) {
  await requireAdmin();

  await db
    .update(adminInvites)
    .set({ isActive: false })
    .where(eq(adminInvites.id, inviteId));

  revalidatePath("/admin/invites");
  return ok(undefined);
}

export async function getInviteCodes() {
  await requireAdmin();

  const invites = await db
    .select()
    .from(adminInvites)
    .orderBy(desc(adminInvites.createdAt))
    .limit(50);

  return ok(invites);
}
