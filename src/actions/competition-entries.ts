"use server";

import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditLogs,
  competitionEntries,
  competitionEntryActiveClaims,
  competitionEntryParticipants,
  competitionEntryRepresentativeTenures,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  competitionEntrySubmissions,
  eventRosters,
  seasons,
  teamMemberships,
  teams,
} from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  evaluateRosterQualification,
  isHomeAffiliatedMember,
  loadEducationMembershipFacts,
  resolveCompetitiveContext,
  resolveSeasonEducationVerification,
} from "@/lib/qualification/service";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { assertUsersNotBlockedInTx } from "@/lib/discipline/service";
import { isTeamRegistration } from "@/lib/utils/season";
import { normalizeAffiliationRules, normalizeTeamRegistrationConfig } from "@/types/season";
import { fail, ok, type ActionResult } from "@/types/action";

const uuid = z.string().uuid();
const editableStatuses = ["draft", "changes_requested"] as const;
type EntryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

function revalidateEntry(seasonSlug: string, entryId?: string): void {
  revalidatePath(`/${seasonSlug}/register`);
  revalidatePath(`/admin/${seasonSlug}/registrations`);
  revalidatePath("/my/competitions");
  if (entryId) revalidatePath(`/${seasonSlug}/entries/${entryId}`);
}

async function lockEntry(tx: EntryTx, entryId: string) {
  const [entry] = await tx.select().from(competitionEntries).where(eq(competitionEntries.id, entryId)).for("update");
  if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
  return entry;
}

async function lockRepresentativeEntry(tx: EntryTx, entryId: string, userId: string) {
  const entry = await lockEntry(tx, entryId);
  if (entry.representativeUserId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "只有本届赛事负责人可以执行此操作。");
  return entry;
}

async function auditEntry(tx: EntryTx, args: { action: string; actorId: string; entryId: string; competitionId: string; meta?: Record<string, unknown> }) {
  await tx.insert(auditLogs).values({ seasonId: args.competitionId, action: args.action, actorId: args.actorId, targetId: args.entryId, targetType: "competition_entry", meta: args.meta ?? null });
}

async function loadSeasonOrThrow(tx: EntryTx, competitionId: string) {
  const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, competitionId) });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。");
  return season;
}

export async function createCompetitionEntry(input: { competitionId: string; teamId: string }): Promise<ActionResult<{ entryId: string }>> {
  const parsed = z.object({ competitionId: uuid, teamId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛事或队伍标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const season = await loadSeasonOrThrow(tx, parsed.data.competitionId);
      if (!isTeamRegistration(season)) throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前赛事不使用队伍报名。");
      const window = getRegistrationWindowState(season);
      if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
      const [team] = await tx.select().from(teams).where(eq(teams.id, parsed.data.teamId)).for("update");
      if (!team || team.status !== "active") throw new AppError(ErrorCode.NOT_FOUND, "长期队伍不存在或已解散。");
      if (team.captainUserId !== session.userId) throw new AppError(ErrorCode.FORBIDDEN, "只有长期 Team 队长可以创建参赛条目。");
      const existing = await tx.query.competitionEntries.findFirst({ where: and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.teamId, team.id), inArray(competitionEntries.registrationStatus, ["draft", "submitted", "changes_requested", "waitlisted", "approved"])) });
      if (existing) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "这支 Team 已有本届有效参赛条目。");
      const [entry] = await tx.insert(competitionEntries).values({ competitionId: season.id, source: "linked_team", teamId: team.id, name: team.name, logoUrl: team.logoUrl, representativeUserId: team.captainUserId }).returning({ id: competitionEntries.id });
      await tx.insert(competitionEntryRosterRevisions).values({ entryId: entry.id, revision: 1, status: "draft", createdBy: auditActorId(session) });
      await tx.insert(competitionEntryRepresentativeTenures).values({ entryId: entry.id, userId: team.captainUserId, transferredBy: auditActorId(session) });
      await auditEntry(tx, { action: "competition_entry.create", actorId: auditActorId(session), entryId: entry.id, competitionId: season.id, meta: { source: "linked_team", teamId: team.id, nameSnapshot: team.name } });
      return { entryId: entry.id, seasonSlug: season.slug };
    });
    revalidateEntry(result.seasonSlug, result.entryId);
    return ok({ entryId: result.entryId });
  } catch (error) { return actionError("createCompetitionEntry", error); }
}

export async function saveCompetitionEntryRoster(input: { entryId: string; userIds: string[]; primaryStarterUserIds: string[]; perfectTeamId?: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid, userIds: z.array(uuid).min(1).max(9), primaryStarterUserIds: z.array(uuid).max(5), perfectTeamId: z.string().trim().max(128).optional() }).safeParse(input);
  if (!parsed.success || new Set(parsed.data.userIds).size !== parsed.data.userIds.length || new Set(parsed.data.primaryStarterUserIds).size !== parsed.data.primaryStarterUserIds.length || parsed.data.primaryStarterUserIds.some((id) => !parsed.data.userIds.includes(id))) return invalid("赛事名单或预定主力无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const entry = await lockRepresentativeEntry(tx, parsed.data.entryId, session.userId);
      if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名版本不可编辑。");
      if (!entry.teamId) throw new AppError(ErrorCode.VALIDATION_FAILED, "event-native Entry 不通过 linked Team roster 编辑入口修改。");
      const season = await loadSeasonOrThrow(tx, entry.competitionId);
      const window = getRegistrationWindowState(season);
      if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
      const currentMemberships = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, entry.teamId), inArray(teamMemberships.userId, parsed.data.userIds), isNull(teamMemberships.endedAt)));
      if (currentMemberships.length !== parsed.data.userIds.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "新选择的名单成员必须当前仍属于 linked Team。");
      const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.entryId, entry.id), eq(competitionEntryRosterRevisions.revision, entry.currentRosterRevision))).for("update");
      if (!revision || revision.status !== "draft") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前 roster revision 不可编辑。");
      const existingParticipants = await tx.select().from(competitionEntryParticipants).where(eq(competitionEntryParticipants.entryId, entry.id));
      const selected = new Set(parsed.data.userIds);
      const confirmedRemoved = existingParticipants.filter((participant) => participant.status === "confirmed" && !selected.has(participant.userId));
      if (confirmedRemoved.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "已确认参赛的成员不能被静默移除；请先执行赛事退出。");
      const participantByUser = new Map(existingParticipants.map((row) => [row.userId, row]));
      for (const userId of parsed.data.userIds) {
        const existing = participantByUser.get(userId);
        if (!existing) {
          const [created] = await tx.insert(competitionEntryParticipants).values({ entryId: entry.id, userId, invitedByUserId: session.userId, status: "invited" }).returning();
          participantByUser.set(userId, created);
        } else if (existing.status === "declined") {
          await tx.update(competitionEntryParticipants).set({ status: "invited", invitedByUserId: session.userId, updatedAt: new Date() }).where(eq(competitionEntryParticipants.id, existing.id));
          participantByUser.set(userId, { ...existing, status: "invited", invitedByUserId: session.userId, updatedAt: new Date() });
        }
      }
      await tx.delete(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, revision.id));
      await tx.insert(competitionEntryRosterMembers).values(parsed.data.userIds.map((userId) => ({ revisionId: revision.id, participantId: participantByUser.get(userId)!.id, userId, teamMembershipId: currentMemberships.find((row) => row.userId === userId)?.id ?? null, isPrimaryStarter: parsed.data.primaryStarterUserIds.includes(userId) })));
      await tx.update(competitionEntries).set({ perfectTeamId: parsed.data.perfectTeamId || null, updatedAt: new Date() }).where(eq(competitionEntries.id, entry.id));
      await auditEntry(tx, { action: "competition_entry.roster.save", actorId: auditActorId(session), entryId: entry.id, competitionId: entry.competitionId, meta: { revision: revision.revision, rosterSize: parsed.data.userIds.length, primaryStarterCount: parsed.data.primaryStarterUserIds.length } });
      return { seasonSlug: season.slug };
    });
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("saveCompetitionEntryRoster", error); }
}

export async function confirmCompetitionEntryParticipation(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${session.userId} FOR UPDATE`);
      const entry = await lockEntry(tx, parsed.data.entryId);
      if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名阶段不能确认新成员。");
      const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, session.userId))).for("update");
      if (!participant) throw new AppError(ErrorCode.NOT_FOUND, "你不在当前 Entry roster 中。");
      if (participant.status === "confirmed") return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug, alreadyConfirmed: true };
      if (participant.status !== "invited") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前成员状态不能确认参赛。");
      const [claim] = await tx.insert(competitionEntryActiveClaims).values({ competitionId: entry.competitionId, userId: session.userId, entryId: entry.id, participantId: participant.id }).onConflictDoNothing().returning({ entryId: competitionEntryActiveClaims.entryId });
      if (!claim) {
        const existing = await tx.query.competitionEntryActiveClaims.findFirst({ where: and(eq(competitionEntryActiveClaims.competitionId, entry.competitionId), eq(competitionEntryActiveClaims.userId, session.userId)) });
        if (!existing || existing.entryId !== entry.id) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "你已确认代表本届赛事的另一支 Entry。");
      }
      await tx.update(competitionEntryParticipants).set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(competitionEntryParticipants.id, participant.id));
      await auditEntry(tx, { action: "competition_entry.participant.confirm", actorId: auditActorId(session), entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: session.userId } });
      return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug, alreadyConfirmed: false };
    });
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("confirmCompetitionEntryParticipation", error); }
}

export async function withdrawCompetitionEntryParticipation(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const entry = await lockEntry(tx, parsed.data.entryId);
      if (entry.registrationStatus === "approved") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "已批准名单必须通过 roster-change workflow 退出。");
      const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, session.userId))).for("update");
      if (!participant || participant.status !== "confirmed") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前没有可退出的已确认承诺。");
      if (entry.representativeUserId === session.userId) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先将赛事负责人交接给另一位已确认成员，再退出本届赛事。");
      await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.participantId, participant.id));
      await tx.update(competitionEntryParticipants).set({ status: "withdrawn", withdrawnAt: new Date(), updatedAt: new Date() }).where(eq(competitionEntryParticipants.id, participant.id));
      await auditEntry(tx, { action: "competition_entry.participant.withdraw", actorId: auditActorId(session), entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: session.userId } });
      return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
    });
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("withdrawCompetitionEntryParticipation", error); }
}

export async function declineCompetitionEntryParticipation(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const entry = await lockEntry(tx, parsed.data.entryId);
      if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名阶段不能拒绝邀请。");
      const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, session.userId))).for("update");
      if (!participant || participant.status !== "invited") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前没有可拒绝的 Entry 邀请。");
      await tx.update(competitionEntryParticipants).set({ status: "declined", updatedAt: new Date() }).where(eq(competitionEntryParticipants.id, participant.id));
      await auditEntry(tx, { action: "competition_entry.participant.decline", actorId: auditActorId(session), entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: session.userId } });
      return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
    });
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("declineCompetitionEntryParticipation", error); }
}

export async function withdrawCompetitionEntry(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const entry = await lockRepresentativeEntry(tx, parsed.data.entryId, session.userId);
      if (entry.registrationStatus === "approved") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "已批准 Entry 必须由赛事管理员处理退赛和后续裁决。");
      if (inArrayStatus(entry.registrationStatus, ["rejected", "withdrawn"])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前 Entry 已经终止。");
      const now = new Date();
      await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.entryId, entry.id));
      await tx.update(competitionEntries).set({ registrationStatus: "withdrawn", updatedAt: now }).where(eq(competitionEntries.id, entry.id));
      const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.entryId, entry.id), eq(competitionEntryRosterRevisions.revision, entry.currentRosterRevision))).limit(1);
      if (revision) {
        const [{ value }] = await tx.select({ value: count() }).from(competitionEntrySubmissions).where(eq(competitionEntrySubmissions.entryId, entry.id));
        await tx.insert(competitionEntrySubmissions).values({ entryId: entry.id, rosterRevisionId: revision.id, sequence: Number(value) + 1, decision: "withdrawn", submittedBy: auditActorId(session), submittedAt: now, decidedBy: auditActorId(session), decidedAt: now });
      }
      await auditEntry(tx, { action: "competition_entry.withdraw", actorId: auditActorId(session), entryId: entry.id, competitionId: entry.competitionId, meta: { from: entry.registrationStatus } });
      return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
    });
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("withdrawCompetitionEntry", error); }
}

export async function requestCompetitionEntryRosterChange(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const entry = await lockRepresentativeEntry(tx, parsed.data.entryId, session.userId);
      if (entry.registrationStatus !== "approved" || entry.approvedRosterRevision === null) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有已批准 Entry 可以发起 roster change。");
      const frozen = await tx.query.eventRosters.findFirst({ where: and(eq(eventRosters.entryId, entry.id), eq(eventRosters.status, "frozen")) });
      if (frozen) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "event roster 已冻结；名单变化必须走赛事运营裁决，不能回写报名事实。");
      const season = await loadSeasonOrThrow(tx, entry.competitionId);
      if (!getRegistrationWindowState(season).canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, "报名窗口已关闭；请联系赛事管理员发起名单变更。");
      const [approved] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.entryId, entry.id), eq(competitionEntryRosterRevisions.revision, entry.approvedRosterRevision))).for("update");
      if (!approved) throw new AppError(ErrorCode.INTERNAL_ERROR, "已批准 roster revision 不存在。");
      const nextRevision = entry.currentRosterRevision + 1;
      const [next] = await tx.insert(competitionEntryRosterRevisions).values({ entryId: entry.id, revision: nextRevision, status: "draft", createdBy: auditActorId(session) }).returning({ id: competitionEntryRosterRevisions.id });
      const members = await tx.select().from(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, approved.id));
      if (members.length > 0) await tx.insert(competitionEntryRosterMembers).values(members.map((member) => ({ revisionId: next.id, participantId: member.participantId, userId: member.userId, teamMembershipId: member.teamMembershipId, isPrimaryStarter: member.isPrimaryStarter })));
      await tx.update(competitionEntries).set({ registrationStatus: "changes_requested", currentRosterRevision: nextRevision, reviewReason: "Entry representative requested an approved-roster change", updatedAt: new Date() }).where(eq(competitionEntries.id, entry.id));
      await auditEntry(tx, { action: "competition_entry.roster_change.request", actorId: auditActorId(session), entryId: entry.id, competitionId: entry.competitionId, meta: { approvedRevision: approved.revision, nextRevision } });
      return { seasonSlug: season.slug };
    });
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("requestCompetitionEntryRosterChange", error); }
}

async function validateEntryRoster(
  tx: EntryTx,
  entry: typeof competitionEntries.$inferSelect,
  season: typeof seasons.$inferSelect,
  allowedRevisionStatuses: readonly ("draft" | "submitted")[],
  options: { requireCurrentTeamMembership: boolean },
) {
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.entryId, entry.id), eq(competitionEntryRosterRevisions.revision, entry.currentRosterRevision))).for("update");
  if (!revision || !allowedRevisionStatuses.includes(revision.status as "draft" | "submitted")) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前 roster revision 不可用于此操作。");
  const rows = await tx.select({ userId: competitionEntryRosterMembers.userId, primary: competitionEntryRosterMembers.isPrimaryStarter, participantStatus: competitionEntryParticipants.status })
    .from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryParticipants, eq(competitionEntryRosterMembers.participantId, competitionEntryParticipants.id))
    .where(eq(competitionEntryRosterMembers.revisionId, revision.id));
  if (rows.length < season.minTeamSize || rows.length > season.maxTeamSize) throw new AppError(ErrorCode.VALIDATION_FAILED, `本届名单需为 ${season.minTeamSize}-${season.maxTeamSize} 人。`);
  if (rows.some((row) => row.participantStatus !== "confirmed")) throw new AppError(ErrorCode.VALIDATION_FAILED, "所有 roster participant 必须分别确认代表本 Entry 参赛。");
  const userLabels = new Map(rows.map((row) => [row.userId, row.userId]));
  await assertUsersNotBlockedInTx(tx, { seasonId: season.id, userLabels, effect: "registration_block", message: "以下成员当前被禁止报名" });
  await assertUsersNotBlockedInTx(tx, { seasonId: season.id, userLabels, effect: "roster_block", message: "以下成员当前不能进入赛事名单" });
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  const primaryIds = rows.filter((row) => row.primary).map((row) => row.userId);
  if (season.starterCount > 0 && (primaryIds.length !== season.starterCount || new Set(primaryIds).size !== season.starterCount)) throw new AppError(ErrorCode.VALIDATION_FAILED, `必须指定恰好 ${season.starterCount} 名预定主力。`);
  if (options.requireCurrentTeamMembership && entry.teamId) {
    const activeMemberships = await tx.select({ userId: teamMemberships.userId }).from(teamMemberships).where(and(eq(teamMemberships.teamId, entry.teamId), eq(teamMemberships.status, "active"), isNull(teamMemberships.endedAt), inArray(teamMemberships.userId, rows.map((row) => row.userId))));
    if (activeMemberships.length !== rows.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "linked Team roster 中有人已不是当前 active member；选择会保留，但提交前必须明确处理。");
  }
  if (config.requireTeamLogo && !entry.logoUrl) throw new AppError(ErrorCode.VALIDATION_FAILED, "本届赛事要求 Entry logo。");
  if (config.requireCompetitiveProfile && !entry.perfectTeamId?.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "本届赛事要求完美战队 ID。");
  const affiliationRules = normalizeAffiliationRules(season.affiliationRules);
  if (config.requireCompetitiveProfile || affiliationRules.length > 0) {
    const facts = await loadEducationMembershipFacts(tx, rows.map((row) => row.userId));
    const members = rows.map((row) => {
      const userFacts = facts.get(row.userId);
      const history = userFacts?.history ?? [];
      const selected = resolveSeasonEducationVerification(history, affiliationRules).selectedVerification;
      return { userId: row.userId, email: userFacts?.email ?? "", emailVerifiedAt: userFacts?.emailVerifiedAt ?? null, educationHistory: history, isHome: isHomeAffiliatedMember({ institutionCode: selected?.institutionCode ?? null, academicStatus: selected?.academicStatus ?? null }, affiliationRules) };
    });
    if (config.requireCompetitiveProfile) {
      if (!config.competitiveProfile) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事尚未冻结竞技档案规则。");
      const profile = await resolveCompetitiveContext(config.competitiveProfile);
      if (!profile) throw new AppError(ErrorCode.VALIDATION_FAILED, "竞技平台赛季目录不可确认。");
      const qualification = await evaluateRosterQualification({ members, affiliationRules, competitiveProfile: profile, primaryStarterUserIds: primaryIds });
      if (!qualification.eligible) throw new AppError(ErrorCode.VALIDATION_FAILED, qualification.blockers.join(" "));
    } else {
      const qualification = await evaluateRosterQualification({ members, affiliationRules, primaryStarterUserIds: primaryIds });
      if (!qualification.eligible) throw new AppError(ErrorCode.VALIDATION_FAILED, qualification.blockers.join(" "));
    }
  }
  return { revision, rosterSize: rows.length, primaryIds };
}

export async function submitCompetitionEntry(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const entry = await lockRepresentativeEntry(tx, parsed.data.entryId, session.userId);
      if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名状态不能提交。");
      const season = await loadSeasonOrThrow(tx, entry.competitionId);
      const window = getRegistrationWindowState(season);
      if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
      const validated = await validateEntryRoster(tx, entry, season, ["draft"], { requireCurrentTeamMembership: true });
      const [{ value }] = await tx.select({ value: count() }).from(competitionEntrySubmissions).where(eq(competitionEntrySubmissions.entryId, entry.id));
      const now = new Date();
      await tx.update(competitionEntryRosterRevisions).set({ status: "submitted", submittedAt: now }).where(eq(competitionEntryRosterRevisions.id, validated.revision.id));
      await tx.insert(competitionEntrySubmissions).values({ entryId: entry.id, rosterRevisionId: validated.revision.id, sequence: Number(value) + 1, decision: "submitted", submittedBy: auditActorId(session), submittedAt: now });
      await tx.update(competitionEntries).set({ registrationStatus: "submitted", submittedAt: now, reviewReason: null, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
      await auditEntry(tx, { action: "competition_entry.submit", actorId: auditActorId(session), entryId: entry.id, competitionId: entry.competitionId, meta: { rosterRevision: validated.revision.revision, rosterSize: validated.rosterSize, primaryStarterCount: validated.primaryIds.length } });
      return { seasonSlug: season.slug };
    });
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("submitCompetitionEntry", error); }
}

export async function reviewCompetitionEntry(input: { entryId: string; decision: "changes_requested" | "waitlisted" | "approved" | "rejected"; reason?: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid, decision: z.enum(["changes_requested", "waitlisted", "approved", "rejected"]), reason: z.string().trim().max(1000).optional() }).safeParse(input);
  if (!parsed.success || ((parsed.data.decision === "changes_requested" || parsed.data.decision === "rejected") && !parsed.data.reason)) return invalid("审核决定或原因无效。");
  try {
    const existing = await db.query.competitionEntries.findFirst({ where: eq(competitionEntries.id, parsed.data.entryId), columns: { competitionId: true } });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
    const admin = await requireSeasonAdmin(existing.competitionId);
    const result = await db.transaction(async (tx) => {
      const entry = await lockEntry(tx, parsed.data.entryId);
      const season = await loadSeasonOrThrow(tx, entry.competitionId);
      if (!inArrayStatus(entry.registrationStatus, ["submitted", "waitlisted"])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有已提交或候补 Entry 可以审核。");
      const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.entryId, entry.id), eq(competitionEntryRosterRevisions.revision, entry.currentRosterRevision))).for("update");
      if (!revision) throw new AppError(ErrorCode.INTERNAL_ERROR, "Entry roster revision 不完整。");
      const [submission] = await tx.select().from(competitionEntrySubmissions).where(and(eq(competitionEntrySubmissions.entryId, entry.id), eq(competitionEntrySubmissions.rosterRevisionId, revision.id))).for("update");
      if (!submission) throw new AppError(ErrorCode.INTERNAL_ERROR, "Entry submission revision 不完整。");
      if (parsed.data.decision === "approved") await validateEntryRoster(tx, entry, season, ["submitted"], { requireCurrentTeamMembership: false });
      const now = new Date();
      await tx.update(competitionEntrySubmissions).set({ decision: parsed.data.decision, decidedBy: auditActorId(admin), decidedAt: now, reason: parsed.data.reason || null }).where(eq(competitionEntrySubmissions.id, submission.id));
      if (parsed.data.decision === "changes_requested") {
        const nextRevision = entry.currentRosterRevision + 1;
        const [next] = await tx.insert(competitionEntryRosterRevisions).values({ entryId: entry.id, revision: nextRevision, status: "draft", createdBy: auditActorId(admin) }).returning({ id: competitionEntryRosterRevisions.id });
        const members = await tx.select().from(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, revision.id));
        if (members.length > 0) await tx.insert(competitionEntryRosterMembers).values(members.map((member) => ({ revisionId: next.id, participantId: member.participantId, userId: member.userId, teamMembershipId: member.teamMembershipId, isPrimaryStarter: member.isPrimaryStarter })));
        await tx.update(competitionEntryRosterRevisions).set({ status: "superseded" }).where(eq(competitionEntryRosterRevisions.id, revision.id));
        await tx.update(competitionEntries).set({ registrationStatus: "changes_requested", currentRosterRevision: nextRevision, reviewedAt: now, reviewReason: parsed.data.reason, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
      } else {
        await tx.update(competitionEntries).set({ registrationStatus: parsed.data.decision, approvedRosterRevision: parsed.data.decision === "approved" ? revision.revision : entry.approvedRosterRevision, reviewedAt: now, reviewReason: parsed.data.reason || null, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
        if (parsed.data.decision === "approved") await tx.update(competitionEntryRosterRevisions).set({ status: "approved", approvedAt: now }).where(eq(competitionEntryRosterRevisions.id, revision.id));
        if (parsed.data.decision === "rejected") await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.entryId, entry.id));
      }
      await auditEntry(tx, { action: `competition_entry.${parsed.data.decision}`, actorId: auditActorId(admin), entryId: entry.id, competitionId: entry.competitionId, meta: { from: entry.registrationStatus, to: parsed.data.decision, rosterRevision: revision.revision, reason: parsed.data.reason || null } });
      return { seasonSlug: season.slug };
    });
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("reviewCompetitionEntry", error); }
}

function inArrayStatus<T extends string>(value: string, options: readonly T[]): value is T {
  return options.includes(value as T);
}

export async function transferCompetitionEntryRepresentative(input: { entryId: string; toUserId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid, toUserId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛事负责人交接信息无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const entry = await lockRepresentativeEntry(tx, parsed.data.entryId, session.userId);
      const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, parsed.data.toUserId))).for("update");
      if (!participant || participant.status !== "confirmed") throw new AppError(ErrorCode.VALIDATION_FAILED, "新赛事负责人必须是当前已确认的 Entry participant。");
      const now = new Date();
      await tx.update(competitionEntryRepresentativeTenures).set({ endedAt: now }).where(and(eq(competitionEntryRepresentativeTenures.entryId, entry.id), isNull(competitionEntryRepresentativeTenures.endedAt)));
      await tx.insert(competitionEntryRepresentativeTenures).values({ entryId: entry.id, userId: parsed.data.toUserId, transferredBy: auditActorId(session) });
      await tx.update(competitionEntries).set({ representativeUserId: parsed.data.toUserId, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
      await auditEntry(tx, { action: "competition_entry.representative.transfer", actorId: auditActorId(session), entryId: entry.id, competitionId: entry.competitionId, meta: { fromUserId: entry.representativeUserId, toUserId: parsed.data.toUserId } });
      return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
    });
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("transferCompetitionEntryRepresentative", error); }
}
