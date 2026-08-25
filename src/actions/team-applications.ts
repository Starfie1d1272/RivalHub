"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditLogs,
  seasons,
  teamApplicationMembers,
  teamApplications,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth } from "@/lib/auth/session";
import { MIN_TEAM_NAME_LENGTH, MAX_TEAM_NAME_LENGTH } from "@/lib/config/team-config";
import { AppError, ErrorCode } from "@/lib/errors";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { normalizeEmail } from "@/lib/utils/email";
import { isTeamRegistration } from "@/lib/utils/season";
import { normalizeTeamRegistrationConfig } from "@/types/season";
import { fail, ok, type ActionResult } from "@/types/action";

const teamNameSchema = z.string().trim().min(MIN_TEAM_NAME_LENGTH).max(MAX_TEAM_NAME_LENGTH);
const applicationIdSchema = z.string().uuid();
const memberEmailSchema = z.string().email();
const editableStatuses = ["draft", "rejected"] as const;
const activeStatuses = ["draft", "submitted", "waitlisted"] as const;

type EditableApplication = {
  id: string;
  seasonId: string;
  captainUserId: string;
  status: string;
  name: string;
  logoUrl: string | null;
};

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

async function getCaptainApplicationOrThrow(applicationId: string, userId: string): Promise<EditableApplication> {
  const application = await db.query.teamApplications.findFirst({
    where: eq(teamApplications.id, applicationId),
  });
  if (!application) throw new AppError(ErrorCode.NOT_FOUND, "报名队伍不存在");
  if (application.captainUserId !== userId) {
    throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以管理报名队伍");
  }
  return application;
}

async function assertEditableApplication(application: EditableApplication): Promise<void> {
  if (!editableStatuses.includes(application.status as (typeof editableStatuses)[number])) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "报名已提交，当前不能修改名单；请等待管理员审核。");
  }
}

async function assertNoOtherActiveApplication(seasonId: string, userId: string, exceptApplicationId?: string): Promise<void> {
  const conditions = [
    eq(teamApplications.seasonId, seasonId),
    eq(teamApplicationMembers.userId, userId),
    inArray(teamApplications.status, [...activeStatuses]),
  ];
  if (exceptApplicationId) conditions.push(ne(teamApplications.id, exceptApplicationId));
  const existing = await db
    .select({ id: teamApplications.id })
    .from(teamApplicationMembers)
    .innerJoin(teamApplications, eq(teamApplicationMembers.applicationId, teamApplications.id))
    .where(and(...conditions))
    .limit(1);
  if (existing.length > 0) {
    throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该选手已经在本赛季另一支有效报名队伍中。");
  }
}

async function assertNoFormalTeamMembership(seasonId: string, userId: string): Promise<void> {
  const existing = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.seasonId, seasonId), eq(teamMembers.userId, userId)),
    columns: { id: true },
  });
  if (existing) {
    throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该选手已经是本赛季正式队伍成员。");
  }
}

function revalidateApplicationPaths(seasonSlug: string): void {
  revalidatePath(`/${seasonSlug}/register`);
  revalidatePath(`/admin/${seasonSlug}/registrations`);
}

export async function createTeamApplication(input: { seasonId: string; name: string }): Promise<ActionResult<{ applicationId: string }>> {
  const parsed = z.object({ seasonId: z.string().uuid(), name: teamNameSchema }).safeParse(input);
  if (!parsed.success) return invalid(`队伍名称需为 ${MIN_TEAM_NAME_LENGTH}-${MAX_TEAM_NAME_LENGTH} 个字符`);

  try {
    const session = await requireAuth();
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, parsed.data.seasonId) });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
    if (!isTeamRegistration(season)) throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前赛季不使用队伍报名。");
    const window = getRegistrationWindowState(season);
    if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);

    await assertNoOtherActiveApplication(season.id, session.userId);
    await assertNoFormalTeamMembership(season.id, session.userId);

    const application = await db.transaction(async (tx) => {
      const [created] = await tx.insert(teamApplications).values({
        seasonId: season.id,
        name: parsed.data.name,
        captainUserId: session.userId,
      }).returning({ id: teamApplications.id });
      if (!created) throw new AppError(ErrorCode.INTERNAL_ERROR, "创建报名队伍失败");
      await tx.insert(teamApplicationMembers).values({
        applicationId: created.id,
        userId: session.userId,
        invitedByUserId: session.userId,
        status: "confirmed",
        confirmedAt: new Date(),
      });
      await tx.insert(auditLogs).values({
        seasonId: season.id,
        action: "team_application.create",
        actorId: auditActorId(session),
        targetId: created.id,
        targetType: "team_application",
        meta: { name: parsed.data.name },
      });
      return created;
    });
    revalidateApplicationPaths(season.slug);
    return ok({ applicationId: application.id });
  } catch (error) {
    return actionError("createTeamApplication", error);
  }
}

export async function updateTeamApplication(input: { applicationId: string; name: string; logoUrl?: string | null }): Promise<ActionResult<void>> {
  const parsed = z.object({ applicationId: z.string().uuid(), name: teamNameSchema, logoUrl: z.string().url().nullable().optional() }).safeParse(input);
  if (!parsed.success) return invalid("请填写有效的队伍名称和图标地址。");
  try {
    const session = await requireAuth();
    const application = await getCaptainApplicationOrThrow(parsed.data.applicationId, session.userId);
    await assertEditableApplication(application);
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, application.seasonId) });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
    const window = getRegistrationWindowState(season);
    if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
    await db.transaction(async (tx) => {
      await tx.update(teamApplications).set({
        name: parsed.data.name,
        logoUrl: parsed.data.logoUrl ?? application.logoUrl,
        updatedAt: new Date(),
      }).where(eq(teamApplications.id, application.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id,
        action: "team_application.update",
        actorId: auditActorId(session),
        targetId: application.id,
        targetType: "team_application",
        meta: { fromName: application.name, toName: parsed.data.name },
      });
    });
    revalidateApplicationPaths(season.slug);
    return ok(undefined);
  } catch (error) {
    return actionError("updateTeamApplication", error);
  }
}

export async function inviteTeamApplicationMember(input: { applicationId: string; email: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ applicationId: applicationIdSchema, email: memberEmailSchema }).safeParse(input);
  if (!parsed.success) return invalid("请输入已注册选手的有效邮箱。");
  try {
    const session = await requireAuth();
    const application = await getCaptainApplicationOrThrow(parsed.data.applicationId, session.userId);
    await assertEditableApplication(application);
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, application.seasonId) });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
    const window = getRegistrationWindowState(season);
    if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
    const user = await db.query.users.findFirst({ where: eq(users.email, normalizeEmail(parsed.data.email)) });
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, "该邮箱尚未注册 RivalHub 账号。");
    await assertNoOtherActiveApplication(application.seasonId, user.id, application.id);
    await assertNoFormalTeamMembership(application.seasonId, user.id);
    const member = await db.query.teamApplicationMembers.findFirst({
      where: and(eq(teamApplicationMembers.applicationId, application.id), eq(teamApplicationMembers.userId, user.id)),
    });
    if (member) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该选手已经在当前报名队伍中。");
    await db.transaction(async (tx) => {
      await tx.insert(teamApplicationMembers).values({
        applicationId: application.id,
        userId: user.id,
        invitedByUserId: session.userId,
      });
      await tx.insert(auditLogs).values({
        seasonId: application.seasonId,
        action: "team_application.invite_member",
        actorId: auditActorId(session),
        targetId: application.id,
        targetType: "team_application",
        meta: { invitedUserId: user.id },
      });
    });
    revalidateApplicationPaths(season.slug);
    return ok(undefined);
  } catch (error) {
    return actionError("inviteTeamApplicationMember", error);
  }
}

export async function removeTeamApplicationMember(input: { applicationId: string; memberId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ applicationId: applicationIdSchema, memberId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return invalid("成员标识无效。");
  try {
    const session = await requireAuth();
    const application = await getCaptainApplicationOrThrow(parsed.data.applicationId, session.userId);
    await assertEditableApplication(application);
    const member = await db.query.teamApplicationMembers.findFirst({ where: eq(teamApplicationMembers.id, parsed.data.memberId) });
    if (!member || member.applicationId !== application.id) throw new AppError(ErrorCode.NOT_FOUND, "报名成员不存在");
    if (member.userId === application.captainUserId) throw new AppError(ErrorCode.VALIDATION_FAILED, "队长不能移除自己；请先联系管理员处理队长变更。");
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, application.seasonId) });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
    await db.transaction(async (tx) => {
      await tx.delete(teamApplicationMembers).where(eq(teamApplicationMembers.id, member.id));
      await tx.insert(auditLogs).values({
        seasonId: application.seasonId,
        action: "team_application.remove_member",
        actorId: auditActorId(session),
        targetId: application.id,
        targetType: "team_application",
        meta: { removedUserId: member.userId },
      });
    });
    revalidateApplicationPaths(season.slug);
    return ok(undefined);
  } catch (error) {
    return actionError("removeTeamApplicationMember", error);
  }
}

export async function confirmTeamApplicationMembership(input: { applicationId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ applicationId: applicationIdSchema }).safeParse(input);
  if (!parsed.success) return invalid("报名队伍标识无效。");
  try {
    const session = await requireAuth();
    const member = await db.query.teamApplicationMembers.findFirst({
      where: and(eq(teamApplicationMembers.applicationId, parsed.data.applicationId), eq(teamApplicationMembers.userId, session.userId)),
    });
    if (!member) throw new AppError(ErrorCode.NOT_FOUND, "你不在该报名队伍的邀请名单中。");
    const application = await db.query.teamApplications.findFirst({ where: eq(teamApplications.id, member.applicationId) });
    if (!application) throw new AppError(ErrorCode.NOT_FOUND, "报名队伍不存在");
    await assertEditableApplication(application);
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, application.seasonId) });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
    if (!getRegistrationWindowState(season).canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, "报名窗口已关闭。");
    await assertNoFormalTeamMembership(application.seasonId, session.userId);
    if (member.status !== "confirmed") {
      await db.transaction(async (tx) => {
        await tx.update(teamApplicationMembers).set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(teamApplicationMembers.id, member.id));
        await tx.insert(auditLogs).values({
          seasonId: application.seasonId,
          action: "team_application.confirm_member",
          actorId: auditActorId(session),
          targetId: application.id,
          targetType: "team_application",
          meta: { memberId: member.id },
        });
      });
    }
    revalidateApplicationPaths(season.slug);
    return ok(undefined);
  } catch (error) {
    return actionError("confirmTeamApplicationMembership", error);
  }
}

export async function submitTeamApplication(input: { applicationId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ applicationId: applicationIdSchema }).safeParse(input);
  if (!parsed.success) return invalid("报名队伍标识无效。");
  try {
    const session = await requireAuth();
    const application = await getCaptainApplicationOrThrow(parsed.data.applicationId, session.userId);
    await assertEditableApplication(application);
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, application.seasonId) });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
    const window = getRegistrationWindowState(season);
    if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
    const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
    const members = await db
      .select({ id: teamApplicationMembers.id, userId: teamApplicationMembers.userId, status: teamApplicationMembers.status, studentId: users.studentId })
      .from(teamApplicationMembers)
      .innerJoin(users, eq(teamApplicationMembers.userId, users.id))
      .where(eq(teamApplicationMembers.applicationId, application.id));
    const confirmed = members.filter((member) => member.status === "confirmed");
    if (confirmed.length < season.minTeamSize || confirmed.length > season.maxTeamSize) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `确认名单必须为 ${season.minTeamSize}-${season.maxTeamSize} 人。`);
    }
    if (!confirmed.some((member) => member.userId === application.captainUserId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "队长必须先确认身份后才能提交报名。");
    }
    if (config.requireTeamLogo && !application.logoUrl) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "本赛事要求提交队伍图标。");
    }
    const homeMembers = confirmed.filter((member) => Boolean(member.studentId)).length;
    const externalMembers = confirmed.length - homeMembers;
    if (!config.allowExternal && externalMembers > 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "该赛事不允许校外成员；请先完成成员身份资料。 ");
    }
    if (homeMembers < config.minHomeMembers || externalMembers > config.maxExternalMembers) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "当前确认名单不符合赛事的成员身份要求。");
    }
    if (config.requireUniqueTeamName) {
      const sameName = await db.query.teams.findFirst({ where: and(eq(teams.seasonId, season.id), eq(teams.name, application.name)) });
      if (sameName) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该队名已被正式队伍使用。");
    }
    await db.transaction(async (tx) => {
      await tx.update(teamApplications).set({
        status: "submitted",
        submittedAt: new Date(),
        reviewReason: null,
        reviewedAt: null,
        reviewedBy: null,
        updatedAt: new Date(),
      }).where(eq(teamApplications.id, application.id));
      await tx.insert(auditLogs).values({
        seasonId: application.seasonId,
        action: "team_application.submit",
        actorId: auditActorId(session),
        targetId: application.id,
        targetType: "team_application",
        meta: { confirmedMemberCount: confirmed.length },
      });
    });
    revalidateApplicationPaths(season.slug);
    return ok(undefined);
  } catch (error) {
    return actionError("submitTeamApplication", error);
  }
}
