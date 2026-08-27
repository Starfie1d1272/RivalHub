"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { eq, and, count, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, seasonRegistrations, auditLogs, adminUsers, adminInvites, users, draftPicks, teamApplicationMembers, teamApplications, teamApplicationActiveClaims, teamMembers, teams, educationVerifications, institutions } from "@/db/schema";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError, failValidation } from "@/lib/action-utils";
import {
  auditActorId,
  requireSeasonAdmin,
  requireSuperAdmin,
  getAdminSession,
} from "@/lib/auth/session";
import { verifyPassword, hashPassword } from "@/lib/utils/password";
import { isProtectedRootUsername } from "@/lib/auth/root-protection";
import { normalizeRegistrationConfig } from "@/types/season";
import { maybeAdvanceFromRegistration } from "@/actions/transitions";
import {
  type RegistrationStatus,
  validateTransition,
} from "@/lib/registration-transitions";
import { normalizeAffiliationRules, normalizeTeamRegistrationConfig } from "@/types/season";
import { evaluateRosterEducationEligibility, type EducationEligibilityMember } from "@/lib/education/eligibility";

// ── 共享工具 ────────────────────────────────────────────

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
  if (user.role !== "super_admin") {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "请使用 /login 的邮箱密码入口登录管理员账号" });
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

    await tx.insert(auditLogs).values({
      seasonId: null,
      action: "admin.register",
      actorId: username,
      targetId: newAdmin.id,
      targetType: "admin_user",
      meta: { role: invite.role, inviteId: invite.id },
    });

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

// ── 队伍报名审核与正式队伍落地 ────────────────────────────

interface TeamApplicationReviewInput {
  applicationId: string;
  status: "approved" | "waitlisted" | "rejected";
  reason?: string;
}

export async function reviewTeamApplication(input: TeamApplicationReviewInput) {
  if (!input || !["approved", "waitlisted", "rejected"].includes(input.status)) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "无效的队伍报名审核状态" });
  }

  try {
    const application = await db.query.teamApplications.findFirst({
      where: eq(teamApplications.id, input.applicationId),
      columns: { seasonId: true },
    });
    if (!application) throw new AppError(ErrorCode.NOT_FOUND, "报名队伍不存在");
    const admin = await requireSeasonAdmin(application.seasonId);

    const result = await db.transaction(async (tx) => {
      // Serialize all reviews of this aggregate. The unique application
      // provenance on teams remains the second, database-enforced idempotency
      // guard if a retry reaches a new transaction.
      await tx.execute(sql`SELECT id FROM team_applications WHERE id = ${input.applicationId} FOR UPDATE`);
      const locked = await tx.query.teamApplications.findFirst({
        where: eq(teamApplications.id, input.applicationId),
      });
      if (!locked) throw new AppError(ErrorCode.NOT_FOUND, "报名队伍不存在");
      const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, locked.seasonId) });
      if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);

      const existingTeam = await tx.query.teams.findFirst({
        where: eq(teams.teamApplicationId, locked.id),
        columns: { id: true },
      });
      if (locked.status === "approved") {
        if (input.status !== "approved") {
          throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "已通过的报名队伍不能直接变更审核结果。");
        }
        if (existingTeam) return { teamId: existingTeam.id, seasonSlug: season.slug, materialized: false };
      }
      if (locked.status !== "submitted" && locked.status !== "waitlisted") {
        throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有已提交或候补的报名队伍可以审核。");
      }

      if (input.status !== "approved") {
        await tx.update(teamApplications).set({
          status: input.status,
          reviewedAt: new Date(),
          reviewedBy: auditActorId(admin),
          reviewReason: input.reason?.trim() || null,
          updatedAt: new Date(),
        }).where(eq(teamApplications.id, locked.id));
        if (input.status === "rejected") await tx.delete(teamApplicationActiveClaims).where(eq(teamApplicationActiveClaims.applicationId, locked.id));
        await tx.insert(auditLogs).values({
          seasonId: locked.seasonId,
          action: `team_application.${input.status}`,
          actorId: auditActorId(admin),
          targetId: locked.id,
          targetType: "team_application",
          meta: { from: locked.status, to: input.status, reason: input.reason?.trim() || null },
        });
        return { teamId: null, seasonSlug: season.slug, materialized: false };
      }

      const members = await tx
        .select({ id: teamApplicationMembers.id, userId: teamApplicationMembers.userId, status: teamApplicationMembers.status, email: users.email, emailVerifiedAt: users.emailVerifiedAt, verificationId: educationVerifications.id, verificationAcademicStatus: educationVerifications.academicStatus, institutionCode: institutions.moeInstitutionCode, institutionName: institutions.name })
        .from(teamApplicationMembers)
        .innerJoin(users, eq(teamApplicationMembers.userId, users.id))
        .leftJoin(educationVerifications, and(eq(educationVerifications.userId, users.id), eq(educationVerifications.status, "approved")))
        .leftJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
        .where(eq(teamApplicationMembers.applicationId, locked.id));
      const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
      const affiliationRules = normalizeAffiliationRules(season.affiliationRules);
      const confirmedByUser = new Map<string, (typeof members)[number]>();
      for (const member of members) {
        if (member.status !== "confirmed") continue;
        const current = confirmedByUser.get(member.userId);
        const matchesRule = member.institutionCode && member.verificationAcademicStatus && affiliationRules.some((rule) =>
          rule.institutionCode === member.institutionCode && rule.eligibleAcademicStatuses.includes(member.verificationAcademicStatus!),
        );
        const currentMatchesRule = current?.institutionCode && current.verificationAcademicStatus && affiliationRules.some((rule) =>
          rule.institutionCode === current.institutionCode && rule.eligibleAcademicStatuses.includes(current.verificationAcademicStatus!),
        );
        if (!current || (matchesRule && !currentMatchesRule)) confirmedByUser.set(member.userId, member);
      }
      const confirmed = [...confirmedByUser.values()];
      const education: EducationEligibilityMember[] = confirmed.map((member) => ({ userId: member.userId, email: member.email, emailVerifiedAt: member.emailVerifiedAt, verification: member.verificationId && member.verificationAcademicStatus && member.institutionName ? { id: member.verificationId, status: "approved", academicStatus: member.verificationAcademicStatus, institutionCode: member.institutionCode, institutionName: member.institutionName } : null }));
      const educationDecision = evaluateRosterEducationEligibility(education, affiliationRules);
      if (
        confirmed.length < season.minTeamSize ||
        confirmed.length > season.maxTeamSize ||
        !confirmed.some((member) => member.userId === locked.captainUserId) ||
        (config.requireTeamLogo && !locked.logoUrl) ||
        (affiliationRules.length > 0 && !educationDecision.eligible)
      ) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, educationDecision.blockers[0] ?? "申请的确认名单已不满足当前赛事规则，不能通过审核。");
      }
      if (config.requireUniqueTeamName) {
        const sameName = await tx.query.teams.findFirst({
          where: and(eq(teams.seasonId, season.id), eq(teams.name, locked.name)),
          columns: { id: true },
        });
        if (sameName) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该队名已被正式队伍使用。");
      }

      const [team] = await tx.insert(teams).values({
        seasonId: locked.seasonId,
        name: locked.name,
        logoUrl: locked.logoUrl,
        captainUserId: locked.captainUserId,
        teamApplicationId: locked.id,
      }).returning({ id: teams.id });
      if (!team) throw new AppError(ErrorCode.INTERNAL_ERROR, "正式队伍创建失败");
      await tx.insert(teamMembers).values(confirmed.map((member) => ({
        teamId: team.id,
        seasonId: locked.seasonId,
        userId: member.userId,
        teamApplicationMemberId: member.id,
        isStarter: false,
      })));
      await tx.update(teamApplications).set({
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: auditActorId(admin),
        reviewReason: input.reason?.trim() || null,
        updatedAt: new Date(),
      }).where(eq(teamApplications.id, locked.id));
      await tx.delete(teamApplicationActiveClaims).where(eq(teamApplicationActiveClaims.applicationId, locked.id));
      await tx.insert(auditLogs).values([
        {
          seasonId: locked.seasonId,
          action: "team_application.approved",
          actorId: auditActorId(admin),
          targetId: locked.id,
          targetType: "team_application",
          meta: { from: locked.status, to: "approved", reason: input.reason?.trim() || null },
        },
        {
          seasonId: locked.seasonId,
          action: "team_application.materialize",
          actorId: auditActorId(admin),
          targetId: team.id,
          targetType: "team",
          meta: { applicationId: locked.id, memberCount: confirmed.length },
        },
      ]);
      return { teamId: team.id, seasonSlug: season.slug, materialized: true };
    });

    revalidatePath(`/admin/${result.seasonSlug}/registrations`);
    revalidatePath(`/${result.seasonSlug}/register`);
    revalidatePath(`/${result.seasonSlug}/teams`);
    return ok({ applicationId: input.applicationId, status: input.status, teamId: result.teamId, materialized: result.materialized });
  } catch (error) {
    return actionError("reviewTeamApplication", error);
  }
}

// ── 邀请码管理 ──────────────────────────────────────────

export async function createInviteCode(input: {
  role?: "admin" | "super_admin";
  seasonId?: string;
  maxUses?: number;
  expiresInHours?: number;
}) {
  const admin = await requireSuperAdmin();
  const { role = "admin", seasonId, maxUses = 1, expiresInHours } = input;

  if (role === "admin" && !seasonId) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请选择赛季范围" });
  }
  if (role === "admin" && seasonId) {
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
  const inviteSeasonId = role === "admin" ? seasonId! : null;

  const [invite] = await db
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

  await db.insert(auditLogs).values({
    seasonId: inviteSeasonId,
    action: "admin.create_invite",
    actorId: auditActorId(admin),
    targetId: invite.id,
    targetType: "admin_invite",
    meta: { role, maxUses, expiresAt: expiresAt?.toISOString() ?? null },
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

  await db
    .update(adminInvites)
    .set({ isActive: false })
    .where(eq(adminInvites.id, inviteId));

  await db.insert(auditLogs).values({
    seasonId: null,
    action: "admin.deactivate_invite",
    actorId: auditActorId(admin),
    targetId: inviteId,
    targetType: "admin_invite",
  });

  revalidatePath("/admin/invites");
  return ok(undefined);
}

export async function getInviteCodes() {
  await requireSuperAdmin();

  const invites = await db
    .select()
    .from(adminInvites)
    .orderBy(desc(adminInvites.createdAt))
    .limit(50);

  return ok(invites);
}

// ── 修改密码 ──────────────────────────────────────────

export async function changePassword(currentPassword: string, newPassword: string) {
  const admin = await requireSuperAdmin();

  if (!newPassword || newPassword.length < 8) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "新密码至少 8 个字符" });
  }
  if (admin.authSource !== "root" || !admin.legacyAdminId) {
    return fail({ code: ErrorCode.FORBIDDEN, message: "该页面仅支持修改 Root 紧急账号密码" });
  }

  const user = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, admin.legacyAdminId),
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

  await db.insert(auditLogs).values({
    seasonId: null,
    action: "admin.change_password",
    actorId: auditActorId(admin),
    targetId: user.id,
    targetType: "admin_user",
  });

  return ok(undefined);
}

// ── 管理员列表 ────────────────────────────────────────

export async function listAdminUsers() {
  await requireSuperAdmin();

  const rows = await db
    .select()
    .from(adminUsers)
    .orderBy(adminUsers.createdAt);

  return ok(rows);
}

export async function deactivateAdminUser(adminId: string) {
  const admin = await requireSuperAdmin();

  if (admin.authSource === "root" && admin.legacyAdminId === adminId) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "不能停用自己的账户" });
  }

  const target = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, adminId),
  });
  if (!target) {
    return fail({ code: ErrorCode.NOT_FOUND, message: "管理员不存在" });
  }
  if (isProtectedRootUsername(target.username)) {
    return fail({ code: ErrorCode.FORBIDDEN, message: "不能停用根管理员" });
  }

  await db
    .update(adminUsers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(adminUsers.id, adminId));

  await db.insert(auditLogs).values({
    seasonId: null,
    action: "admin.deactivate_user",
    actorId: auditActorId(admin),
    targetId: adminId,
    targetType: "admin_user",
    meta: { targetUsername: target.username },
  });

  revalidatePath("/admin/users");
  return ok(undefined);
}

export async function reactivateAdminUser(adminId: string) {
  const admin = await requireSuperAdmin();

  await db
    .update(adminUsers)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(adminUsers.id, adminId));

  await db.insert(auditLogs).values({
    seasonId: null,
    action: "admin.reactivate_user",
    actorId: auditActorId(admin),
    targetId: adminId,
    targetType: "admin_user",
  });

  revalidatePath("/admin/users");
  return ok(undefined);
}

// ── 撤销用户管理员权限 ─────────────────────────────────────

export async function revokeUserAdminRole(userId: string) {
  try {
    const session = await requireSuperAdmin();

    if (userId === session.userId) {
      return failValidation("不能撤销自己的权限");
    }

    const target = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, role: true },
    });
    if (!target) {
      throw new AppError(ErrorCode.NOT_FOUND, "用户不存在");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ role: "user", adminSeasonIds: [], updatedAt: new Date() })
        .where(eq(users.id, userId));

      await tx.insert(auditLogs).values({
        seasonId: null,
        action: "admin.revoke_role",
        actorId: auditActorId(session),
        targetId: userId,
        targetType: "user",
        meta: { from: target.role },
      });
    });

    revalidatePath("/admin/users");
    return ok(undefined);
  } catch (e) {
    return actionError("revokeUserAdminRole", e);
  }
}
