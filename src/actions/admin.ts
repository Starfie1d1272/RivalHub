"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, and, count, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, seasonRegistrations, auditLogs } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireAdmin, getAdminSession } from "@/lib/auth/session";
import { MAX_PER_POSITION } from "@/lib/validators/registration";

// ── 状态迁移合法性校验 ────────────────────────────────────

type RegistrationStatus = "pending" | "approved" | "rejected" | "waitlisted";

// 逐目标状态校验赛季条件（而非逐当前状态共用同一函数）
// 这样可以精确建模：同一个 pending 状态下，不同目标有不同的赛季约束
function validateTransition(
  current: RegistrationStatus,
  target: RegistrationStatus,
  seasonStatus: string,
): void {
  // 禁止迁移集
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

  // 赛季状态条件（精确到 (current, target) 对）
  if (current === "pending") {
    if ((target === "approved" || target === "waitlisted") && seasonStatus !== "registration") {
      // 文档: pending→waitlisted 仅 registration; pending→approved 仅 registration 或 voting
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

  // 检查目标是否在合法集合内
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

function needsPositionCheck(current: RegistrationStatus, target: RegistrationStatus): boolean {
  return target === "approved" && (current === "waitlisted" || current === "rejected");
}

// ── 管理员登录 ──────────────────────────────────────────

export async function adminLogin(inviteCode: string, password: string) {
  const correctInvite = process.env.ADMIN_INVITE_CODE;
  const correctPassword = process.env.ADMIN_PASSWORD;

  if (!correctInvite || !correctPassword) {
    return fail({
      code: ErrorCode.INTERNAL_ERROR,
      message: "管理员凭据未配置，请联系系统管理员设置 ADMIN_INVITE_CODE 和 ADMIN_PASSWORD 环境变量",
    });
  }

  if (inviteCode !== correctInvite) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "邀请码错误" });
  }
  if (password !== correctPassword) {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "密码错误" });
  }

  const session = await getAdminSession();
  session.isAdmin = true;
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
  await requireAdmin();

  const { registrationId, status: targetStatus, reason } = input;

  if (!["approved", "rejected", "waitlisted"].includes(targetStatus)) {
    return fail({
      code: ErrorCode.VALIDATION_FAILED,
      message: "无效的审核状态",
    });
  }

  try {
    // 1. 查报名记录
    const reg = await db.query.seasonRegistrations.findFirst({
      where: eq(seasonRegistrations.id, registrationId),
    });
    if (!reg) {
      throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");
    }

    // 2. 查所属赛季
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, reg.seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }

    // 3. 校验状态迁移合法性
    validateTransition(
      reg.status as RegistrationStatus,
      targetStatus,
      season.status,
    );

    // 4. 如果要通过，检查位置余量
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

    // 5. 更新状态
    await db
      .update(seasonRegistrations)
      .set({
        status: targetStatus,
        updatedAt: new Date(),
      })
      .where(eq(seasonRegistrations.id, registrationId));

    // 6. 写 audit log
    await db.insert(auditLogs).values({
      seasonId: reg.seasonId,
      action: `registration.${targetStatus}`,
      actorId: "admin",
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
