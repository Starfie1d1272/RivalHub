"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditLogs,
  seasons,
  teamApplicationMembers,
  teamApplications,
  teamApplicationActiveClaims,
  teamMembers,
  teams,
  users,
  educationVerifications,
  institutions,
} from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth } from "@/lib/auth/session";
import { assertUsersNotBlockedInTx } from "@/lib/discipline/service";
import { MIN_TEAM_NAME_LENGTH, MAX_TEAM_NAME_LENGTH } from "@/lib/config/team-config";
import { AppError, ErrorCode } from "@/lib/errors";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { normalizeEmail } from "@/lib/utils/email";
import { isTeamRegistration } from "@/lib/utils/season";
import { normalizeAffiliationRules, normalizeTeamRegistrationConfig } from "@/types/season";
import { evaluateRosterEducationEligibility, type EducationEligibilityMember } from "@/lib/education/eligibility";
import { getParticipantReadiness } from "@/lib/major/participant-readiness";
import { evaluateExternalStrengthRule } from "@/lib/major/player-strength";
import { fail, ok, type ActionResult } from "@/types/action";

const teamNameSchema = z.string().trim().min(MIN_TEAM_NAME_LENGTH).max(MAX_TEAM_NAME_LENGTH);
const applicationIdSchema = z.string().uuid();
const memberEmailSchema = z.string().email();
const editableStatuses = ["draft", "rejected"] as const;

type EditableApplication = {
  id: string;
  seasonId: string;
  captainUserId: string;
  status: string;
  name: string;
  logoUrl: string | null;
  perfectTeamId: string | null;
  primaryStarterUserIds: string[];
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

async function claimActiveMembership(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], seasonId: string, userId: string, applicationId: string): Promise<void> {
  const [claim] = await tx.insert(teamApplicationActiveClaims).values({ seasonId, userId, applicationId }).onConflictDoNothing().returning({ applicationId: teamApplicationActiveClaims.applicationId });
  if (!claim) {
    const existing = await tx.query.teamApplicationActiveClaims.findFirst({ where: and(eq(teamApplicationActiveClaims.seasonId, seasonId), eq(teamApplicationActiveClaims.userId, userId)) });
    if (!existing || existing.applicationId !== applicationId) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该选手已经在本赛季另一支有效报名队伍中。");
  }
}

function revalidateApplicationPaths(seasonSlug: string): void {
  revalidatePath(`/${seasonSlug}/register`);
  revalidatePath(`/admin/${seasonSlug}/registrations`);
}

async function assertParticipantReadyForSeason(userId: string, season: typeof seasons.$inferSelect): Promise<void> {
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  if (!config.requireCompetitiveProfile) return;
  if (!config.competitiveProfile) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事尚未配置竞技档案规则，暂不能确认报名资格。");
  const readiness = await getParticipantReadiness(userId, config.competitiveProfile);
  if (!readiness.ready) throw new AppError(ErrorCode.VALIDATION_FAILED, `参赛资料未完善：${readiness.blockers.join(" ")}`);
}

export async function createTeamApplication(input: { seasonId: string; name: string; privacyAcknowledged?: boolean }): Promise<ActionResult<{ applicationId: string }>> {
  const parsed = z.object({ seasonId: z.string().uuid(), name: teamNameSchema, privacyAcknowledged: z.literal(true).optional() }).safeParse(input);
  if (!parsed.success) return invalid(`队伍名称需为 ${MIN_TEAM_NAME_LENGTH}-${MAX_TEAM_NAME_LENGTH} 个字符`);
  if (parsed.data.privacyAcknowledged !== true) return invalid("请先阅读并确认赛事规则与隐私说明。");

  try {
    const session = await requireAuth();
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, parsed.data.seasonId) });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
    if (!isTeamRegistration(season)) throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前赛季不使用队伍报名。");
    const window = getRegistrationWindowState(season);
    if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
    await assertParticipantReadyForSeason(session.userId, season);

    const application = await db.transaction(async (tx) => {
      const formal = await tx.query.teamMembers.findFirst({ where: and(eq(teamMembers.seasonId, season.id), eq(teamMembers.userId, session.userId)) });
      if (formal) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该选手已经是本赛季正式队伍成员。");
      const [created] = await tx.insert(teamApplications).values({
        seasonId: season.id,
        name: parsed.data.name,
        captainUserId: session.userId,
      }).returning({ id: teamApplications.id });
      if (!created) throw new AppError(ErrorCode.INTERNAL_ERROR, "创建报名队伍失败");
      await claimActiveMembership(tx, season.id, session.userId, created.id);
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
        meta: { name: parsed.data.name, privacyAcknowledged: true },
      });
      return created;
    });
    revalidateApplicationPaths(season.slug);
    return ok({ applicationId: application.id });
  } catch (error) {
    return actionError("createTeamApplication", error);
  }
}

export async function updateTeamApplication(input: { applicationId: string; name: string; logoUrl?: string | null; perfectTeamId?: string; primaryStarterUserIds?: string[] }): Promise<ActionResult<void>> {
  const parsed = z.object({ applicationId: z.string().uuid(), name: teamNameSchema, logoUrl: z.string().url().nullable().optional(), perfectTeamId: z.string().trim().max(128).optional(), primaryStarterUserIds: z.array(z.string().uuid()).max(5).optional() }).safeParse(input);
  if (!parsed.success) return invalid("请填写有效的队伍资料和预定主力名单。");
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
        perfectTeamId: parsed.data.perfectTeamId?.trim() || null,
        primaryStarterUserIds: parsed.data.primaryStarterUserIds ?? [],
        updatedAt: new Date(),
      }).where(eq(teamApplications.id, application.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id,
        action: "team_application.update",
        actorId: auditActorId(session),
        targetId: application.id,
        targetType: "team_application",
        meta: { fromName: application.name, toName: parsed.data.name, hasPerfectTeamId: Boolean(parsed.data.perfectTeamId?.trim()), primaryStarterCount: parsed.data.primaryStarterUserIds?.length ?? 0 },
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
    const member = await db.query.teamApplicationMembers.findFirst({
      where: and(eq(teamApplicationMembers.applicationId, application.id), eq(teamApplicationMembers.userId, user.id)),
    });
    if (member) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该选手已经在当前报名队伍中。");
    await db.transaction(async (tx) => {
      const formal = await tx.query.teamMembers.findFirst({ where: and(eq(teamMembers.seasonId, application.seasonId), eq(teamMembers.userId, user.id)) });
      if (formal) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该选手已经是本赛季正式队伍成员。");
      await claimActiveMembership(tx, application.seasonId, user.id, application.id);
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
      await tx.delete(teamApplicationActiveClaims).where(and(eq(teamApplicationActiveClaims.seasonId, application.seasonId), eq(teamApplicationActiveClaims.userId, member.userId), eq(teamApplicationActiveClaims.applicationId, application.id)));
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

export async function confirmTeamApplicationMembership(input: { applicationId: string; privacyAcknowledged?: boolean }): Promise<ActionResult<void>> {
  const parsed = z.object({ applicationId: applicationIdSchema, privacyAcknowledged: z.literal(true).optional() }).safeParse(input);
  if (!parsed.success) return invalid("报名队伍标识无效。");
  if (parsed.data.privacyAcknowledged !== true) return invalid("请先阅读并确认赛事规则与隐私说明。");
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
    await assertParticipantReadyForSeason(session.userId, season);
    if (member.status !== "confirmed") {
      await db.transaction(async (tx) => {
        const formal = await tx.query.teamMembers.findFirst({ where: and(eq(teamMembers.seasonId, application.seasonId), eq(teamMembers.userId, session.userId)) });
        if (formal) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该选手已经是本赛季正式队伍成员。");
        await claimActiveMembership(tx, application.seasonId, session.userId, application.id);
        await tx.update(teamApplicationMembers).set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(teamApplicationMembers.id, member.id));
        await tx.insert(auditLogs).values({
          seasonId: application.seasonId,
          action: "team_application.confirm_member",
          actorId: auditActorId(session),
          targetId: application.id,
          targetType: "team_application",
          meta: { memberId: member.id, privacyAcknowledged: true },
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
      .select({ id: teamApplicationMembers.id, userId: teamApplicationMembers.userId, status: teamApplicationMembers.status, email: users.email, emailVerifiedAt: users.emailVerifiedAt, verificationId: educationVerifications.id, verificationStatus: educationVerifications.status, verificationAcademicStatus: educationVerifications.academicStatus, institutionCode: institutions.moeInstitutionCode, institutionName: institutions.name })
      .from(teamApplicationMembers)
      .innerJoin(users, eq(teamApplicationMembers.userId, users.id))
      .leftJoin(educationVerifications, and(eq(educationVerifications.userId, users.id), eq(educationVerifications.status, "approved")))
      .leftJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
      .where(eq(teamApplicationMembers.applicationId, application.id));
    const affiliationRules = normalizeAffiliationRules(season.affiliationRules);
    // A member can hold more than one approved historical assertion.  Pick a
    // single assertion per person, preferring one that satisfies this season's
    // affiliation rule; joins must never turn that history into duplicate
    // roster seats.
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
    if (confirmed.length < season.minTeamSize || confirmed.length > season.maxTeamSize) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `确认名单必须为 ${season.minTeamSize}-${season.maxTeamSize} 人。`);
    }
    if (!confirmed.some((member) => member.userId === application.captainUserId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "队长必须先确认身份后才能提交报名。");
    }
    if (config.requireCompetitiveProfile) {
      if (!application.perfectTeamId?.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写完美战队 ID。");
      if (application.primaryStarterUserIds.length !== 5 || new Set(application.primaryStarterUserIds).size !== 5) throw new AppError(ErrorCode.VALIDATION_FAILED, "请指定恰好 5 名预定主力。");
      const confirmedIds = new Set(confirmed.map((member) => member.userId));
      if (application.primaryStarterUserIds.some((userId) => !confirmedIds.has(userId))) throw new AppError(ErrorCode.VALIDATION_FAILED, "预定主力必须全部是已确认的正式名单成员。");
      for (const member of confirmed) await assertParticipantReadyForSeason(member.userId, season);
    }
    if (config.requireTeamLogo && !application.logoUrl) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "本赛事要求提交队伍图标。");
    }
    const eligibilityMembers: EducationEligibilityMember[] = confirmed.map((member) => ({ userId: member.userId, email: member.email, emailVerifiedAt: member.emailVerifiedAt, verification: member.verificationId && member.verificationStatus && member.verificationAcademicStatus && member.institutionName ? { id: member.verificationId, status: member.verificationStatus, academicStatus: member.verificationAcademicStatus, institutionCode: member.institutionCode, institutionName: member.institutionName } : null }));
    const eligibility = evaluateRosterEducationEligibility(eligibilityMembers, affiliationRules);
    if (affiliationRules.length > 0 && !eligibility.eligible) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, eligibility.blockers.join(" "));
    }
    if (config.requireCompetitiveProfile && config.competitiveProfile) {
      const readiness = await Promise.all(confirmed.map(async (member) => ({
        member,
        readiness: await getParticipantReadiness(member.userId, config.competitiveProfile!),
      })));
      const unreadied = readiness.filter((item) => !item.readiness.ready);
      if (unreadied.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, unreadied.flatMap((item) => item.readiness.blockers).join(" "));
      const byUser = new Map(readiness.map((item) => [item.member.userId, item]));
      const primary = application.primaryStarterUserIds.map((userId) => byUser.get(userId)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      const strength = evaluateExternalStrengthRule({
        config: config.competitiveProfile,
        players: primary.map(({ member, readiness: memberReadiness }) => ({
          ...memberReadiness.strength,
          isHome: Boolean(member.institutionCode && member.verificationAcademicStatus && affiliationRules.some((rule) => rule.institutionCode === member.institutionCode && rule.eligibleAcademicStatuses.includes(member.verificationAcademicStatus!))),
        })),
      });
      if (!strength.eligible) throw new AppError(ErrorCode.VALIDATION_FAILED, strength.blockers.join(" "));
    }
    // H1: personal registration sanctions block only their subject.
    await assertUsersNotBlockedInTx(db, {
      seasonId: application.seasonId,
      userLabels: new Map(confirmed.map((member) => [member.userId, member.email])),
      effect: "registration_block",
      message: "存在处于有效期内的报名禁赛处罚成员",
    });
    if (config.requireUniqueTeamName) {
      const sameName = await db.query.teams.findFirst({ where: and(eq(teams.seasonId, season.id), eq(teams.name, application.name)) });
      if (sameName) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该队名已被正式队伍使用。");
    }
    await db.transaction(async (tx) => {
      // Rejected applications deliberately release their claims.  A resubmit
      // therefore reclaims every confirmed member in this same transaction so
      // it cannot race another captain's invitation.
      for (const member of confirmed) {
        const formal = await tx.query.teamMembers.findFirst({ where: and(eq(teamMembers.seasonId, application.seasonId), eq(teamMembers.userId, member.userId)) });
        if (formal) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该选手已经是本赛季正式队伍成员。");
        await claimActiveMembership(tx, application.seasonId, member.userId, application.id);
      }
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
