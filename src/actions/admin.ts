"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { eq, and, count, inArray, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, seasonRegistrations, auditLogs, adminUsers, adminInvites } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireAdmin, getAdminSession } from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/utils/password";
import { MAX_PER_POSITION } from "@/lib/validators/registration";

// ── 共享工具 ────────────────────────────────────────────

type RegistrationStatus = "pending" | "approved" | "rejected" | "waitlisted";

async function createAdminSession(user: {
  id: string;
  username: string;
  role: "super_admin" | "admin";
}) {
  const session = await getAdminSession();
  session.isAdmin = true;
  session.adminId = user.id;
  session.adminUsername = user.username;
  session.adminRole = user.role;
  await session.save();
}

// ── 状态机（数据驱动） ──────────────────────────────────

type TransitionKey = `${RegistrationStatus}→${RegistrationStatus}`;

interface TransitionRule {
  /** 空数组 = 任意赛季阶段都允许 */
  allowedSeasonStatuses: string[];
}

const TRANSITION_RULES: Partial<Record<TransitionKey, TransitionRule>> = {
  "pending→approved":    { allowedSeasonStatuses: ["registration", "voting"] },
  "pending→rejected":    { allowedSeasonStatuses: [] },
  "pending→waitlisted":  { allowedSeasonStatuses: ["registration"] },
  "waitlisted→approved": { allowedSeasonStatuses: ["registration", "voting"] },
  "waitlisted→rejected": { allowedSeasonStatuses: [] },
  "approved→rejected":   { allowedSeasonStatuses: ["registration"] },
  "rejected→approved":   { allowedSeasonStatuses: ["registration"] },
};

function validateTransition(
  current: RegistrationStatus,
  target: RegistrationStatus,
  seasonStatus: string,
): void {
  const key = `${current}→${target}` as TransitionKey;
  const rule = TRANSITION_RULES[key];

  if (!rule) {
    throw new AppError(
      ErrorCode.REGISTRATION_INVALID_TRANSITION,
      `不允许从 ${current} 变更为 ${target}`,
    );
  }

  const allowed = rule.allowedSeasonStatuses;
  if (allowed.length > 0 && !allowed.includes(seasonStatus)) {
    throw new AppError(
      ErrorCode.SEASON_INVALID_STATUS,
      `当前赛季状态不允许此操作（${seasonStatus}）`,
    );
  }
}

async function checkPositionAvailability(seasonId: string, primaryPosition: string) {
  const [posCount] = await db
    .select({ count: count() })
    .from(seasonRegistrations)
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.primaryPosition, primaryPosition),
        inArray(seasonRegistrations.status, ["pending", "approved"]),
      ),
    );
  if (Number(posCount?.count ?? 0) >= MAX_PER_POSITION) {
    throw new AppError(ErrorCode.POSITION_FULL, ERROR_MESSAGES.POSITION_FULL);
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
  if (!user.isActive) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "该账户已被停用" });
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "用户名或密码错误" });
  }

  await createAdminSession(user);
  redirect("/admin");
}

// ── 管理员注册（需有效邀请码） ──────────────────────────

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

  const existing = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.username, username),
  });
  if (existing) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "用户名已被使用" });
  }

  // 事务内检查 + 更新邀请码，防止并发超限
  const result = await db.transaction(async (tx) => {
    const invite = await tx.query.adminInvites.findFirst({
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

    const [newAdmin] = await tx
      .insert(adminUsers)
      .values({
        username,
        passwordHash: hashPassword(password),
        role: invite.role,
      })
      .returning();

    await tx
      .update(adminInvites)
      .set({
        usedCount: invite.usedCount + 1,
        isActive: invite.usedCount + 1 >= invite.maxUses ? false : invite.isActive,
        usedByUsernames: sql`array_append(${adminInvites.usedByUsernames}, ${username})`,
      })
      .where(eq(adminInvites.id, invite.id));

    return ok(newAdmin);
  });

  if (!result.success) return result;

  const newAdmin = result.data;
  await createAdminSession(newAdmin);
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

      if (targetStatus === "approved") {
        const [posCount] = await tx
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

      await tx
        .update(seasonRegistrations)
        .set({ status: targetStatus, updatedAt: new Date() })
        .where(eq(seasonRegistrations.id, registrationId));

      await tx.insert(auditLogs).values({
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
  const admin = await requireAdmin();
  const { role = "admin", maxUses = 1, expiresInHours } = input;
  const code = randomBytes(8).toString("hex");

  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 3600_000)
    : null;

  await db.insert(adminInvites).values({
    code,
    createdBy: admin.adminId!,
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

// ── 修改密码 ──────────────────────────────────────────

export async function changePassword(currentPassword: string, newPassword: string) {
  const admin = await requireAdmin();

  if (!newPassword || newPassword.length < 8) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "新密码至少 8 个字符" });
  }

  const user = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, admin.adminId!),
  });
  if (!user) {
    return fail({ code: ErrorCode.NOT_FOUND, message: "管理员账户不存在" });
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "当前密码错误" });
  }

  await db
    .update(adminUsers)
    .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(adminUsers.id, user.id));

  return ok(undefined);
}

// ── 管理员列表 ────────────────────────────────────────

export async function listAdminUsers() {
  await requireAdmin();

  const rows = await db
    .select()
    .from(adminUsers)
    .orderBy(adminUsers.createdAt);

  return ok(rows);
}

export async function deactivateAdminUser(adminId: string) {
  const admin = await requireAdmin();

  if (admin.adminId === adminId) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "不能停用自己的账户" });
  }

  const target = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, adminId),
  });
  if (!target) {
    return fail({ code: ErrorCode.NOT_FOUND, message: "管理员不存在" });
  }
  if (target.username === "RivalHub_root") {
    return fail({ code: ErrorCode.FORBIDDEN, message: "不能停用根管理员" });
  }
  if (admin.adminRole !== "super_admin") {
    return fail({ code: ErrorCode.FORBIDDEN, message: "仅超级管理员可执行此操作" });
  }

  await db
    .update(adminUsers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(adminUsers.id, adminId));

  revalidatePath("/admin/users");
  return ok(undefined);
}

export async function reactivateAdminUser(adminId: string) {
  const admin = await requireAdmin();

  if (admin.adminRole !== "super_admin") {
    return fail({ code: ErrorCode.FORBIDDEN, message: "仅超级管理员可执行此操作" });
  }

  await db
    .update(adminUsers)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(adminUsers.id, adminId));

  revalidatePath("/admin/users");
  return ok(undefined);
}
