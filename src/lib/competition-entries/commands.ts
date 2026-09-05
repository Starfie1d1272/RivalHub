import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  competitionEntries,
  competitionEntryActiveClaims,
  competitionEntryParticipants,
  competitionEntryRepresentativeChanges,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  competitionEntryRestrictionOverrides,
  competitionEntrySubmissions,
  seasons,
  teamMemberships,
  teams,
  users,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  evaluateRosterQualificationFromFacts,
  isHomeAffiliatedMember,
  loadParticipantQualificationFacts,
  resolveCompetitiveContext,
  resolveSeasonEducationVerification,
  type ParticipantQualificationFacts,
  type RosterQualificationResult,
} from "@/lib/qualification/service";
import {
  loadActiveRestrictionOverridesInTx,
  sameQualificationFindingSnapshot,
  snapshotQualificationFinding,
  unresolvedQualificationFindings,
} from "@/lib/competition-entries/restriction-overrides";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { assertUsersNotBlockedInTx } from "@/lib/discipline/service";
import { isTeamRegistration } from "@/lib/utils/season";
import { getDisplayName } from "@/lib/identity/display-name";
import { canMutateCompetitionEntryRoster } from "@/lib/competition-entries/remediation";
import { reconcileMajorPrestartRosterAfterApprovalInTx } from "@/lib/major/prestart-roster";
import { normalizeAffiliationRules, normalizeTeamRegistrationConfig } from "@/types/season";

const editableStatuses = ["draft", "changes_requested"] as const;

async function lockEntry(tx: TxDb, entryId: string) {
  const [entry] = await tx.select().from(competitionEntries).where(eq(competitionEntries.id, entryId)).for("update");
  if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
  return entry;
}

async function lockRepresentativeEntry(tx: TxDb, entryId: string, userId: string) {
  const entry = await lockEntry(tx, entryId);
  if (entry.representativeUserId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "只有本届赛事负责人可以执行此操作。");
  return entry;
}

async function loadSeasonOrThrow(tx: TxDb, competitionId: string) {
  const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, competitionId) });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。");
  return season;
}

async function auditEntry(tx: TxDb, args: { action: string; actorId: string; entryId: string; competitionId: string; meta?: Record<string, unknown> }) {
  await tx.insert(auditLogs).values({ seasonId: args.competitionId, action: args.action, actorId: args.actorId, targetId: args.entryId, targetType: "competition_entry", meta: args.meta ?? null });
}

async function nextRepresentativeChangeAt(tx: TxDb, entryId: string): Promise<Date> {
  const [latest] = await tx.select({ changedAt: competitionEntryRepresentativeChanges.changedAt })
    .from(competitionEntryRepresentativeChanges)
    .where(eq(competitionEntryRepresentativeChanges.entryId, entryId))
    .orderBy(desc(competitionEntryRepresentativeChanges.changedAt), desc(competitionEntryRepresentativeChanges.id))
    .limit(1);
  const now = Date.now();
  return new Date(Math.max(now, latest ? latest.changedAt.getTime() + 1 : now));
}

function assertQualificationFindingsAllowed(
  qualification: RosterQualificationResult,
  options: { requireActiveRestrictionOverrides: boolean; overrides: readonly (typeof competitionEntryRestrictionOverrides.$inferSelect)[] },
): void {
  const unresolved = options.requireActiveRestrictionOverrides
    ? unresolvedQualificationFindings(qualification.findings, options.overrides)
    : qualification.findings.filter((finding) => !finding.waivable);
  if (unresolved.length === 0) return;
  throw new AppError(
    ErrorCode.VALIDATION_FAILED,
    unresolved.map((finding) => finding.message).join(" "),
  );
}

async function validateEntryRoster(
  tx: TxDb,
  entry: typeof competitionEntries.$inferSelect,
  season: typeof seasons.$inferSelect,
  allowedRevisionStatuses: readonly ("draft" | "submitted" | "approved")[],
  options: { requireCurrentTeamMembership: boolean; requireActiveRestrictionOverrides?: boolean },
) {
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision || !allowedRevisionStatuses.includes(revision.status as "draft" | "submitted" | "approved")) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前 roster revision 不可用于此操作。");
  const rows = await tx.select({ userId: competitionEntryRosterMembers.userId, primary: competitionEntryRosterMembers.isPrimaryStarter, participantStatus: competitionEntryParticipants.status })
    .from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryParticipants, eq(competitionEntryRosterMembers.participantId, competitionEntryParticipants.id))
    .where(eq(competitionEntryRosterMembers.revisionId, revision.id));
  if (rows.length < season.minTeamSize || rows.length > season.maxTeamSize) throw new AppError(ErrorCode.VALIDATION_FAILED, `本届名单需为 ${season.minTeamSize}-${season.maxTeamSize} 人。`);
  if (rows.some((row) => row.participantStatus !== "confirmed")) throw new AppError(ErrorCode.VALIDATION_FAILED, "所有 roster participant 必须分别确认代表本 Entry 参赛。");
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  const primaryIds = rows.filter((row) => row.primary).map((row) => row.userId);
  if (season.starterCount > 0 && (primaryIds.length !== season.starterCount || new Set(primaryIds).size !== season.starterCount)) throw new AppError(ErrorCode.VALIDATION_FAILED, `必须指定恰好 ${season.starterCount} 名预定主力。`);
  const affiliationRules = normalizeAffiliationRules(season.affiliationRules);
  const needsQualificationFacts = config.requireCompetitiveProfile || affiliationRules.length > 0;
  let qualificationFacts = new Map<string, ParticipantQualificationFacts>();
  let competitiveProfile: Awaited<ReturnType<typeof resolveCompetitiveContext>> = null;
  let userLabels: Map<string, string>;
  if (needsQualificationFacts) {
    if (config.requireCompetitiveProfile) {
      if (!config.competitiveProfile) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事尚未冻结竞技档案规则。");
      competitiveProfile = await resolveCompetitiveContext(config.competitiveProfile);
      if (!competitiveProfile) throw new AppError(ErrorCode.VALIDATION_FAILED, "竞技平台赛季目录不可确认。");
    }
    // One bundle supplies labels, education/affiliation and (when requested)
    // competitive facts for the complete roster decision.
    qualificationFacts = await loadParticipantQualificationFacts(rows.map((row) => row.userId), {
      executor: tx,
      includeCompetitiveFacts: competitiveProfile !== null,
      platform: competitiveProfile?.platform,
      fallbackPlatform: competitiveProfile?.fallbackConversion?.sourcePlatform,
    });
    userLabels = new Map(rows.map((row) => {
      const fact = qualificationFacts.get(row.userId);
      return [row.userId, getDisplayName(fact ?? {})] as const;
    }));
  } else {
    const participantUsers = rows.length === 0
      ? []
      : await tx.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, email: users.email })
        .from(users).where(inArray(users.id, rows.map((row) => row.userId)));
    userLabels = new Map(participantUsers.map((user) => [user.id, getDisplayName(user)]));
  }
  await assertUsersNotBlockedInTx(tx, { seasonId: season.id, userLabels, effect: "registration_block", message: "以下成员当前被禁止报名" });
  await assertUsersNotBlockedInTx(tx, { seasonId: season.id, userLabels, effect: "roster_block", message: "以下成员当前不能进入赛事名单" });
  if (options.requireCurrentTeamMembership && entry.teamId) {
    const activeMemberships = await tx.select({ userId: teamMemberships.userId }).from(teamMemberships).where(and(eq(teamMemberships.teamId, entry.teamId), eq(teamMemberships.status, "active"), isNull(teamMemberships.endedAt), inArray(teamMemberships.userId, rows.map((row) => row.userId))));
    if (activeMemberships.length !== rows.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前名单中有人已不再是这支队伍的当前成员；选择会保留，但提交前必须明确处理。");
  }
  if (config.requireTeamLogo && !entry.logoUrl) throw new AppError(ErrorCode.VALIDATION_FAILED, "本届赛事要求 Entry logo。");
  if (config.requireCompetitiveProfile && !entry.perfectTeamId?.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "本届赛事要求完美战队 ID。");
  if (needsQualificationFacts) {
    const members = rows.map((row) => {
      const userFacts = qualificationFacts.get(row.userId);
      const history = userFacts?.educationHistory ?? [];
      const selected = resolveSeasonEducationVerification(history, affiliationRules).selectedVerification;
      return { userId: row.userId, email: userFacts?.email ?? "", emailVerifiedAt: userFacts?.emailVerifiedAt ?? null, educationHistory: history, isHome: isHomeAffiliatedMember({ institutionCode: selected?.institutionCode ?? null, academicStatus: selected?.academicStatus ?? null }, affiliationRules) };
    });
    const qualification = await evaluateRosterQualificationFromFacts({
      members,
      facts: qualificationFacts,
      affiliationRules,
      competitiveProfile,
      primaryStarterUserIds: primaryIds,
    });
    const overrides = options.requireActiveRestrictionOverrides
      ? await loadActiveRestrictionOverridesInTx(tx, { competitionId: entry.competitionId, entryIds: [entry.id], rosterRevisionIds: [revision.id] })
      : [];
    assertQualificationFindingsAllowed(qualification, { requireActiveRestrictionOverrides: Boolean(options.requireActiveRestrictionOverrides), overrides });
    return { revision, rosterSize: rows.length, primaryIds, qualification };
  }
  return { revision, rosterSize: rows.length, primaryIds, qualification: null };
}

/**
 * Re-check an approved Entry before it becomes a selected Major entrant.
 * Qualification and restriction semantics stay in the Entry command owner;
 * prestart only consumes this contract before materializing EventRoster.
 */
export async function validateApprovedCompetitionEntryRosterInTx(
  tx: TxDb,
  entry: typeof competitionEntries.$inferSelect,
  season: typeof seasons.$inferSelect,
) {
  if (entry.registrationStatus !== "approved" || !entry.approvedRosterRevisionId || entry.currentRosterRevisionId !== entry.approvedRosterRevisionId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "只能选择当前仍处于 approved 状态且指向已批准名单版本的 CompetitionEntry。 ");
  }
  return validateEntryRoster(tx, entry, season, ["approved"], {
    requireCurrentTeamMembership: false,
    requireActiveRestrictionOverrides: true,
  });
}

export async function createCompetitionEntryInTx(tx: TxDb, input: { competitionId: string; teamId: string; userId: string; actorId: string }): Promise<{ entryId: string; seasonSlug: string }> {
  const season = await loadSeasonOrThrow(tx, input.competitionId);
  if (!isTeamRegistration(season)) throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前赛事不使用队伍报名。");
  const window = getRegistrationWindowState(season);
  if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
  const [team] = await tx.select().from(teams).where(eq(teams.id, input.teamId)).for("update");
  if (!team || team.status !== "active") throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在或已解散。");
  if (team.captainUserId !== input.userId) throw new AppError(ErrorCode.FORBIDDEN, "只有队伍队长可以创建参赛条目。");
  const existing = await tx.query.competitionEntries.findFirst({ where: and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.teamId, team.id), inArray(competitionEntries.registrationStatus, ["draft", "submitted", "changes_requested", "waitlisted", "approved"])) });
  if (existing) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "这支队伍已有本届有效参赛条目。");
  const revisionId = randomUUID();
  const [entry] = await tx.insert(competitionEntries).values({ competitionId: season.id, source: "linked_team", teamId: team.id, name: team.name, logoUrl: team.logoUrl, representativeUserId: team.captainUserId, currentRosterRevisionId: revisionId }).returning({ id: competitionEntries.id });
  await tx.insert(competitionEntryRosterRevisions).values({ id: revisionId, entryId: entry.id, revisionNumber: 1, status: "draft", createdBy: input.actorId });
  await tx.insert(competitionEntryRepresentativeChanges).values({ entryId: entry.id, fromUserId: null, toUserId: team.captainUserId, changedByActorId: input.actorId });
  await auditEntry(tx, { action: "competition_entry.create", actorId: input.actorId, entryId: entry.id, competitionId: season.id, meta: { source: "linked_team", teamId: team.id, nameSnapshot: team.name } });
  return { entryId: entry.id, seasonSlug: season.slug };
}

export async function saveCompetitionEntryRosterInTx(tx: TxDb, input: { entryId: string; userIds: string[]; primaryStarterUserIds: string[]; perfectTeamId?: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockRepresentativeEntry(tx, input.entryId, input.userId);
  if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名版本不可编辑。");
  if (!entry.teamId) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事组队报名不能通过队伍名单编辑入口修改。");
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  const currentMemberships = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, entry.teamId), inArray(teamMemberships.userId, input.userIds), isNull(teamMemberships.endedAt)));
  if (currentMemberships.length !== input.userIds.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "新选择的名单成员必须当前仍属于这支队伍。");
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision || revision.status !== "draft") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前 roster revision 不可编辑。");
  const window = getRegistrationWindowState(season);
  if (!canMutateCompetitionEntryRoster(entry.registrationStatus as "draft" | "changes_requested", revision.origin, season)) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
  const existingParticipants = await tx.select().from(competitionEntryParticipants).where(eq(competitionEntryParticipants.entryId, entry.id));
  const selected = new Set(input.userIds);
  const confirmedRemoved = existingParticipants.filter((participant) => participant.status === "confirmed" && !selected.has(participant.userId));
  if (confirmedRemoved.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "已确认参赛的成员不能被静默移除；请先执行赛事退出。");
  const participantByUser = new Map(existingParticipants.map((row) => [row.userId, row]));
  for (const userId of input.userIds) {
    const existing = participantByUser.get(userId);
    if (!existing) {
      const [created] = await tx.insert(competitionEntryParticipants).values({ entryId: entry.id, userId, invitedByUserId: input.userId, status: "invited" }).returning();
      participantByUser.set(userId, created);
    } else if (existing.status === "declined" || existing.status === "withdrawn") {
      const reinvitedAt = new Date();
      await tx.update(competitionEntryParticipants).set({ status: "invited", invitedByUserId: input.userId, confirmedAt: null, withdrawnAt: null, updatedAt: reinvitedAt }).where(eq(competitionEntryParticipants.id, existing.id));
      participantByUser.set(userId, { ...existing, status: "invited", invitedByUserId: input.userId, confirmedAt: null, withdrawnAt: null, updatedAt: reinvitedAt });
      await auditEntry(tx, { action: "competition_entry.participant.reinvite", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: existing.id, userId, previousStatus: existing.status } });
    }
  }
  await tx.delete(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, revision.id));
  await tx.insert(competitionEntryRosterMembers).values(input.userIds.map((userId) => ({ revisionId: revision.id, participantId: participantByUser.get(userId)!.id, userId, teamMembershipId: currentMemberships.find((row) => row.userId === userId)?.id ?? null, isPrimaryStarter: input.primaryStarterUserIds.includes(userId) })));
  await tx.update(competitionEntries).set({ perfectTeamId: input.perfectTeamId || null, updatedAt: new Date() }).where(eq(competitionEntries.id, entry.id));
  await auditEntry(tx, { action: "competition_entry.roster.save", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { revision: revision.revisionNumber, rosterSize: input.userIds.length, primaryStarterCount: input.primaryStarterUserIds.length } });
  return { seasonSlug: season.slug };
}

export async function confirmCompetitionEntryParticipationInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string; alreadyConfirmed: boolean }> {
  await tx.execute(sql`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`);
  const entry = await lockEntry(tx, input.entryId);
  if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名阶段不能确认新成员。");
  const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, input.userId))).for("update");
  if (!participant) throw new AppError(ErrorCode.NOT_FOUND, "你不在当前 Entry roster 中。");
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision || revision.status !== "draft") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前 roster revision 不可编辑。");
  const window = getRegistrationWindowState(season);
  if (!canMutateCompetitionEntryRoster(entry.registrationStatus as "draft" | "changes_requested", revision.origin, season)) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
  if (participant.status === "confirmed") return { seasonSlug: season.slug, alreadyConfirmed: true };
  if (participant.status !== "invited") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前成员状态不能确认参赛。");
  const [claim] = await tx.insert(competitionEntryActiveClaims).values({ competitionId: entry.competitionId, userId: input.userId, entryId: entry.id, participantId: participant.id }).onConflictDoNothing().returning({ entryId: competitionEntryActiveClaims.entryId });
  if (!claim) {
    const existing = await tx.query.competitionEntryActiveClaims.findFirst({ where: and(eq(competitionEntryActiveClaims.competitionId, entry.competitionId), eq(competitionEntryActiveClaims.userId, input.userId)) });
    if (!existing || existing.entryId !== entry.id) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "你已确认代表本届赛事的另一支 Entry。");
  }
  await tx.update(competitionEntryParticipants).set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(competitionEntryParticipants.id, participant.id));
  await auditEntry(tx, { action: "competition_entry.participant.confirm", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: input.userId } });
  return { seasonSlug: season.slug, alreadyConfirmed: false };
}

export async function withdrawCompetitionEntryParticipationInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockEntry(tx, input.entryId);
  if (entry.registrationStatus === "approved") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "已批准名单必须通过 roster-change workflow 退出。");
  const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, input.userId))).for("update");
  if (!participant || participant.status !== "confirmed") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前没有可退出的已确认承诺。");
  if (entry.representativeUserId === input.userId) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先将赛事负责人交接给另一位已确认成员，再退出本届赛事。");
  await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.participantId, participant.id));
  await tx.update(competitionEntryParticipants).set({ status: "withdrawn", withdrawnAt: new Date(), updatedAt: new Date() }).where(eq(competitionEntryParticipants.id, participant.id));
  await auditEntry(tx, { action: "competition_entry.participant.withdraw", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: input.userId } });
  return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
}

export async function declineCompetitionEntryParticipationInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockEntry(tx, input.entryId);
  if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名阶段不能拒绝邀请。");
  const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, input.userId))).for("update");
  if (!participant || participant.status !== "invited") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前没有可拒绝的 Entry 邀请。");
  await tx.update(competitionEntryParticipants).set({ status: "declined", updatedAt: new Date() }).where(eq(competitionEntryParticipants.id, participant.id));
  await auditEntry(tx, { action: "competition_entry.participant.decline", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: input.userId } });
  return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
}

export async function withdrawCompetitionEntryInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockRepresentativeEntry(tx, input.entryId, input.userId);
  if (entry.registrationStatus === "approved") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "已批准 Entry 必须由赛事管理员处理退赛和后续裁决。");
  if (["rejected", "withdrawn"].includes(entry.registrationStatus)) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前 Entry 已经终止。");
  const now = new Date();
  await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.entryId, entry.id));
  await tx.update(competitionEntries).set({ registrationStatus: "withdrawn", updatedAt: now }).where(eq(competitionEntries.id, entry.id));
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).limit(1);
  if (revision) {
    const [{ value }] = await tx.select({ value: count() }).from(competitionEntrySubmissions).where(eq(competitionEntrySubmissions.entryId, entry.id));
    await tx.insert(competitionEntrySubmissions).values({ entryId: entry.id, rosterRevisionId: revision.id, sequence: Number(value) + 1, decision: "withdrawn", submittedBy: input.actorId, submittedAt: now, decidedBy: input.actorId, decidedAt: now });
  }
  await auditEntry(tx, { action: "competition_entry.withdraw", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { from: entry.registrationStatus } });
  return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
}

export async function submitCompetitionEntryInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockRepresentativeEntry(tx, input.entryId, input.userId);
  if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名状态不能提交。");
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  const window = getRegistrationWindowState(season);
  const validated = await validateEntryRoster(tx, entry, season, ["draft"], { requireCurrentTeamMembership: true, requireActiveRestrictionOverrides: false });
  if (!canMutateCompetitionEntryRoster(entry.registrationStatus as "draft" | "changes_requested", validated.revision.origin, season)) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
  const [{ value }] = await tx.select({ value: count() }).from(competitionEntrySubmissions).where(eq(competitionEntrySubmissions.entryId, entry.id));
  const now = new Date();
  await tx.update(competitionEntryRosterRevisions).set({ status: "submitted", submittedAt: now }).where(eq(competitionEntryRosterRevisions.id, validated.revision.id));
  await tx.insert(competitionEntrySubmissions).values({ entryId: entry.id, rosterRevisionId: validated.revision.id, sequence: Number(value) + 1, decision: "submitted", submittedBy: input.actorId, submittedAt: now });
  await tx.update(competitionEntries).set({ registrationStatus: "submitted", submittedAt: now, reviewReason: null, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
  await auditEntry(tx, { action: "competition_entry.submit", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { rosterRevision: validated.revision.revisionNumber, rosterSize: validated.rosterSize, primaryStarterCount: validated.primaryIds.length } });
  return { seasonSlug: season.slug };
}

/** Grant one currently-present, explicitly waivable qualification restriction. */
export async function grantCompetitionEntryRestrictionOverrideInTx(
  tx: TxDb,
  input: { entryId: string; restrictionCode: string; reason: string; actorId: string },
): Promise<{ seasonSlug: string; overrideId: string; alreadyGranted: boolean }> {
  const entry = await lockEntry(tx, input.entryId);
  if (!["submitted", "waitlisted"].includes(entry.registrationStatus)) {
    throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有已提交或候补 Entry 可以解除资格限制。 ");
  }
  const reason = input.reason.trim();
  const restrictionCode = input.restrictionCode.trim();
  if (!reason || !restrictionCode) throw new AppError(ErrorCode.VALIDATION_FAILED, "解除限制必须填写具体限制和非空理由。 ");
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  const validated = await validateEntryRoster(tx, entry, season, ["submitted"], {
    requireCurrentTeamMembership: false,
    requireActiveRestrictionOverrides: false,
  });
  const matchingFindings = validated.qualification?.findings.filter((candidate) => candidate.code === restrictionCode) ?? [];
  const finding = matchingFindings[0];
  if (!finding) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前报名不存在该资格限制，拒绝写入解除记录。 ");
  if (matchingFindings.some((candidate) => !candidate.waivable)) throw new AppError(ErrorCode.VALIDATION_FAILED, "资料不完整或结构性问题不可通过解除限制处理。 ");

  const [active] = await tx.select().from(competitionEntryRestrictionOverrides)
    .where(and(
      eq(competitionEntryRestrictionOverrides.entryId, entry.id),
      eq(competitionEntryRestrictionOverrides.rosterRevisionId, validated.revision.id),
      eq(competitionEntryRestrictionOverrides.restrictionCode, restrictionCode),
      isNull(competitionEntryRestrictionOverrides.revokedAt),
    ))
    .for("update");
  if (active) {
    if (sameQualificationFindingSnapshot(active.findingSnapshot, finding)) {
      return { seasonSlug: season.slug, overrideId: active.id, alreadyGranted: true };
    }
    throw new AppError(ErrorCode.VALIDATION_FAILED, "该解除记录对应的资格事实已经变化，请先撤销旧记录后重新解除。 ");
  }

  const grantedAt = new Date();
  const [override] = await tx.insert(competitionEntryRestrictionOverrides).values({
    competitionId: entry.competitionId,
    entryId: entry.id,
    rosterRevisionId: validated.revision.id,
    restrictionCode,
    findingSnapshot: snapshotQualificationFinding(finding),
    reason,
    grantedBy: input.actorId,
    grantedAt,
  }).returning({ id: competitionEntryRestrictionOverrides.id });
  if (!override) throw new AppError(ErrorCode.INTERNAL_ERROR, "解除限制记录创建失败。 ");
  await auditEntry(tx, {
    action: "competition_entry.restriction_override.grant",
    actorId: input.actorId,
    entryId: entry.id,
    competitionId: entry.competitionId,
    meta: {
      overrideId: override.id,
      rosterRevisionId: validated.revision.id,
      restrictionCode,
      findingSnapshot: snapshotQualificationFinding(finding),
      reason,
      grantedAt: grantedAt.toISOString(),
    },
  });
  return { seasonSlug: season.slug, overrideId: override.id, alreadyGranted: false };
}

/** Revoke a pre-approval restriction override without deleting its history. */
export async function revokeCompetitionEntryRestrictionOverrideInTx(
  tx: TxDb,
  input: { entryId: string; restrictionCode: string; actorId: string },
): Promise<{ seasonSlug: string }> {
  const entry = await lockEntry(tx, input.entryId);
  if (!["submitted", "waitlisted"].includes(entry.registrationStatus)) {
    throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有待审核或候补 Entry 可以撤销解除限制。 ");
  }
  const [override] = await tx.select().from(competitionEntryRestrictionOverrides)
    .where(and(
      eq(competitionEntryRestrictionOverrides.entryId, entry.id),
      eq(competitionEntryRestrictionOverrides.rosterRevisionId, entry.currentRosterRevisionId),
      eq(competitionEntryRestrictionOverrides.restrictionCode, input.restrictionCode.trim()),
      isNull(competitionEntryRestrictionOverrides.revokedAt),
    ))
    .for("update");
  if (!override) throw new AppError(ErrorCode.NOT_FOUND, "当前报名没有对应的有效解除记录。 ");
  const now = new Date();
  await tx.update(competitionEntryRestrictionOverrides).set({ revokedBy: input.actorId, revokedAt: now }).where(eq(competitionEntryRestrictionOverrides.id, override.id));
  await auditEntry(tx, {
    action: "competition_entry.restriction_override.revoke",
    actorId: input.actorId,
    entryId: entry.id,
    competitionId: entry.competitionId,
    meta: {
      overrideId: override.id,
      rosterRevisionId: override.rosterRevisionId,
      restrictionCode: override.restrictionCode,
      findingSnapshot: override.findingSnapshot,
      reason: override.reason,
      grantedBy: override.grantedBy,
      grantedAt: override.grantedAt.toISOString(),
      revokedAt: now.toISOString(),
    },
  });
  return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
}

export async function reviewCompetitionEntryInTx(tx: TxDb, input: { entryId: string; decision: "changes_requested" | "waitlisted" | "approved" | "rejected"; reason?: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const [entryScope] = await tx.select({ competitionId: competitionEntries.competitionId })
    .from(competitionEntries).where(eq(competitionEntries.id, input.entryId));
  if (!entryScope) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, entryScope.competitionId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。 ");
  const entry = await lockEntry(tx, input.entryId);
  if (!["submitted", "waitlisted"].includes(entry.registrationStatus)) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有已提交或候补 Entry 可以审核。");
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision) throw new AppError(ErrorCode.INTERNAL_ERROR, "Entry roster revision 不完整。");
  const [submission] = await tx.select().from(competitionEntrySubmissions).where(and(eq(competitionEntrySubmissions.entryId, entry.id), eq(competitionEntrySubmissions.rosterRevisionId, revision.id))).for("update");
  if (!submission) throw new AppError(ErrorCode.INTERNAL_ERROR, "Entry submission revision 不完整。");
  if (input.decision === "approved") {
    await validateEntryRoster(tx, entry, season, ["submitted"], { requireCurrentTeamMembership: false, requireActiveRestrictionOverrides: true });
  }
  const now = new Date();
  await tx.update(competitionEntrySubmissions).set({ decision: input.decision, decidedBy: input.actorId, decidedAt: now, reason: input.reason || null }).where(eq(competitionEntrySubmissions.id, submission.id));
  if (input.decision === "changes_requested") {
    const nextRevision = revision.revisionNumber + 1;
    const [next] = await tx.insert(competitionEntryRosterRevisions).values({ entryId: entry.id, revisionNumber: nextRevision, status: "draft", origin: "admin_remediation", createdBy: input.actorId }).returning({ id: competitionEntryRosterRevisions.id });
    const members = await tx.select().from(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, revision.id));
    if (members.length > 0) await tx.insert(competitionEntryRosterMembers).values(members.map((member) => ({ revisionId: next.id, participantId: member.participantId, userId: member.userId, teamMembershipId: member.teamMembershipId, isPrimaryStarter: member.isPrimaryStarter })));
    await tx.update(competitionEntryRosterRevisions).set({ status: "superseded" }).where(eq(competitionEntryRosterRevisions.id, revision.id));
    await tx.update(competitionEntries).set({ registrationStatus: "changes_requested", currentRosterRevisionId: next.id, reviewedAt: now, reviewReason: input.reason, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
  } else {
    await tx.update(competitionEntries).set({ registrationStatus: input.decision, approvedRosterRevisionId: input.decision === "approved" ? revision.id : entry.approvedRosterRevisionId, reviewedAt: now, reviewReason: input.reason || null, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
    if (input.decision === "approved") {
      await tx.update(competitionEntryRosterRevisions).set({ status: "approved", approvedAt: now }).where(eq(competitionEntryRosterRevisions.id, revision.id));
      await reconcileMajorPrestartRosterAfterApprovalInTx(tx, { seasonId: season.id, entryId: entry.id, actorId: input.actorId });
    }
    if (input.decision === "rejected") await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.entryId, entry.id));
  }
  await auditEntry(tx, { action: `competition_entry.${input.decision}`, actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { from: entry.registrationStatus, to: input.decision, rosterRevision: revision.revisionNumber, reason: input.reason || null } });
  return { seasonSlug: season.slug };
}

export async function transferCompetitionEntryRepresentativeInTx(tx: TxDb, input: { entryId: string; userId: string; toUserId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockRepresentativeEntry(tx, input.entryId, input.userId);
  const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, input.toUserId))).for("update");
  if (!participant || participant.status !== "confirmed") throw new AppError(ErrorCode.VALIDATION_FAILED, "新赛事负责人必须是当前已确认的 Entry participant。");
  const now = new Date();
  await tx.insert(competitionEntryRepresentativeChanges).values({ entryId: entry.id, fromUserId: entry.representativeUserId, toUserId: input.toUserId, changedAt: await nextRepresentativeChangeAt(tx, entry.id), changedByActorId: input.actorId });
  await tx.update(competitionEntries).set({ representativeUserId: input.toUserId, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
  await auditEntry(tx, { action: "competition_entry.representative.transfer", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { fromUserId: entry.representativeUserId, toUserId: input.toUserId } });
  return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
}
