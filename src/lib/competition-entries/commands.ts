import { randomUUID } from "node:crypto";
import { writeAuditInTx } from "@/lib/audit/write";
import type { AuditAction } from "@/lib/audit/presentation";

import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
    eventRosters,
  competitionEntries,
  competitionEntryActiveClaims,
  competitionEntryParticipants,
  competitionEntryRepresentativeChanges,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  competitionEntryRestrictionOverrides,
  competitionEntrySubmissions,
  seasons,
  seasonRegistrations,
  steamProfiles,
  teamMemberships,
  teams,
  users,
  userCompetitiveRoles,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  evaluateRosterQualificationFromFacts,
  evaluateParticipant,
  isHomeAffiliatedMember,
  loadParticipantQualificationFacts,
  resolveCompetitiveContext,
  resolveSeasonEducationVerification,
  type ParticipantQualificationFacts,
  type RosterQualificationResult,
} from "@/lib/qualification/service";
import {
  loadActiveRestrictionOverridesInTx,
  unresolvedQualificationFindings,
  sameQualificationFindingSnapshot,
  snapshotQualificationFinding,
} from "@/lib/competition-entries/restriction-overrides";
import { canSelfChangeApprovedRoster, getRegistrationWindowState } from "@/lib/registration/window";
import { loadActiveSanctionsInTx } from "@/lib/discipline/service";
import { isTeamRegistration } from "@/lib/utils/season";
import { getDisplayName } from "@/lib/identity/display-name";
import { canMutateCompetitionEntryRoster } from "@/lib/competition-entries/remediation";
import { requestCompetitionEntryRosterChangeInTx } from "@/lib/competition-entries/roster-change";
import { normalizeTeamRegistrationConfig, resolveQualificationPolicy } from "@/lib/seasons/compatibility";
import { decodeSeasonRules, type RosterCandidate, type DecodedSeasonRules, type QualificationDecision, type QualificationEvidence } from "@/lib/seasons/rules";
import { buildQualificationEvidence, deriveCompetitiveRequirements, type CompetitivePurpose } from "@/lib/qualification/evidence";
import { evaluateRoster } from "@/lib/competition-entries/evaluate-roster";
import { uniqueQualificationFindings } from "@/lib/qualification/finding";
import type { PlayerType } from "@/types/season";
import { assessEntryRosterReadiness } from "@/lib/competition-entries/readiness";
import { normalizePerfectTeamId } from "@/lib/competition-entries/perfect-team-id";
import { ensureRegistrationOpenForParticipantInTx } from "@/lib/seasons/registration-recovery";
import { canReleaseEliminatedParticipationInTx } from "@/lib/major/eliminated-entry";
import { canSelfAdjustMajorRosterInTx } from "@/lib/major/roster-window";

const editableStatuses = ["draft", "changes_requested"] as const;

async function lockEntrySeason(tx: TxDb, entryId: string) {
  const [scope] = await tx.select({ competitionId: competitionEntries.competitionId }).from(competitionEntries).where(eq(competitionEntries.id, entryId));
  if (!scope) throw new AppError(ErrorCode.NOT_FOUND, "未找到本届报名。");
  // Match prestart mutations: season first; FK audit inserts can keep their key-share lock.
  const [season] = await tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, scope.competitionId)).for("no key update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。");
}

async function lockEntry(tx: TxDb, entryId: string) {
  await lockEntrySeason(tx, entryId);
  const [entry] = await tx.select().from(competitionEntries).where(eq(competitionEntries.id, entryId)).for("update");
  if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
  return entry;
}

async function lockRepresentativeEntry(tx: TxDb, entryId: string, userId: string) {
  const entry = await lockEntry(tx, entryId);
  if (entry.representativeUserId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "只有本届赛事负责人可以执行此操作。");
  return entry;
}

async function assertRosterNotFrozen(tx: TxDb, entryId: string) {
  const [roster] = await tx.select({ status: eventRosters.status }).from(eventRosters).where(eq(eventRosters.entryId, entryId)).for("update");
  if (roster?.status === "frozen") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "最终名单已锁定，请联系赛事管理员处理名单变化。");
}

async function loadSeasonOrThrow(tx: TxDb, competitionId: string) {
  const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, competitionId) });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。");
  return season;
}

async function auditEntry(tx: TxDb, args: { action: AuditAction; actorId: string; entryId: string; competitionId: string; meta?: Record<string, unknown> }) {
  await writeAuditInTx(tx, { seasonId: args.competitionId, action: args.action, actorId: args.actorId, targetId: args.entryId,meta: args.meta ?? null });
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

async function cloneRosterRevisionAsDraftInTx(
  tx: TxDb,
  revision: typeof competitionEntryRosterRevisions.$inferSelect,
  createdBy: string,
  origin = revision.origin,
) {
  const nextRevision = revision.revisionNumber + 1;
  const [next] = await tx.insert(competitionEntryRosterRevisions).values({
    entryId: revision.entryId,
    revisionNumber: nextRevision,
    status: "draft",
    origin,
    createdBy,
  }).returning({ id: competitionEntryRosterRevisions.id });
  const members = await tx.select().from(competitionEntryRosterMembers)
    .where(eq(competitionEntryRosterMembers.revisionId, revision.id));
  if (members.length > 0) {
    await tx.insert(competitionEntryRosterMembers).values(members.map((member) => ({
      revisionId: next.id,
      participantId: member.participantId,
      userId: member.userId,
      teamMembershipId: member.teamMembershipId,
      isPrimaryStarter: member.isPrimaryStarter,
    })));
  }
  await tx.update(competitionEntryRosterRevisions).set({ status: "superseded" })
    .where(eq(competitionEntryRosterRevisions.id, revision.id));
  return { id: next.id, revisionNumber: nextRevision };
}

async function validateEntryRosterInTx(
  tx: TxDb,
  entry: typeof competitionEntries.$inferSelect,
  season: typeof seasons.$inferSelect,
  allowedRevisionStatuses: readonly ("draft" | "submitted" | "approved")[],
  options: { requireCurrentTeamMembership: boolean; requireActiveRestrictionOverrides?: boolean; recheckExternalStrength?: boolean },
) {
  if (decodeSeasonRules(season).source === "policy_v2") {
    const assessment = await assessEntryRosterInTx(tx, { entryId: entry.id, expectedRevisionId: entry.currentRosterRevisionId });
    const revision = assessment.candidate.revision;
    if (!allowedRevisionStatuses.includes(revision.status as "draft" | "submitted" | "approved")) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前名单版本不可用于此操作。");
    const findings = assessment.findings.filter((finding) => options.recheckExternalStrength !== false || finding.code !== "external_strength_gap");
    const blockers = options.requireActiveRestrictionOverrides ? unresolvedQualificationFindings(findings, assessment.approvedOverrides) : findings.filter((finding) => !finding.waivable);
    if (blockers.length) throw new AppError(ErrorCode.VALIDATION_FAILED, blockers.map((finding) => finding.message).join(" "));
    return { revision, rosterSize: assessment.candidate.members.length, primaryIds: assessment.candidate.members.filter((member) => member.isPrimaryStarter).map((member) => member.userId), qualification: { findings }, assessment };
  }
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision || !allowedRevisionStatuses.includes(revision.status as "draft" | "submitted" | "approved")) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前名单版本不可用于此操作。");
  const rows = await tx.select({ userId: competitionEntryRosterMembers.userId, primary: competitionEntryRosterMembers.isPrimaryStarter, participantStatus: competitionEntryParticipants.status })
    .from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryParticipants, eq(competitionEntryRosterMembers.participantId, competitionEntryParticipants.id))
    .where(eq(competitionEntryRosterMembers.revisionId, revision.id));
  const config = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  const primaryIds = rows.filter((row) => row.primary).map((row) => row.userId);
  const policy = resolveQualificationPolicy(season.teamRegistrationConfig, season.affiliationRules, "participant");
  const v1 = !!season.teamRegistrationConfig?.qualificationPolicy;
  const affiliationRules = policy.affiliationRules;
  const needsCompetitiveContext = v1 ? policy.competitiveProfileRequired || policy.externalStrengthGap.enabled : config.requireCompetitiveProfile;
  const needsQualificationFacts = v1 || config.requireCompetitiveProfile || affiliationRules.length > 0;
  let qualificationFacts = new Map<string, ParticipantQualificationFacts>();
  let competitiveProfile: Awaited<ReturnType<typeof resolveCompetitiveContext>> = null;
  let userLabels: Map<string, string>;
  if (needsQualificationFacts) {
    if (needsCompetitiveContext) {
      if (!policy.competitiveProfile) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事尚未冻结竞技档案规则。");
      competitiveProfile = await resolveCompetitiveContext(policy.competitiveProfile);
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
      : await tx.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName, email: users.email })
        .from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(inArray(users.id, rows.map((row) => row.userId)));
    userLabels = new Map(participantUsers.map((user) => [user.id, getDisplayName(user)]));
  }
  const registrationBlocks = await loadActiveSanctionsInTx(tx, { seasonId: season.id, subjectUserIds: rows.map((row) => row.userId), effect: "registration_block" });
  const rosterBlocks = await loadActiveSanctionsInTx(tx, { seasonId: season.id, subjectUserIds: rows.map((row) => row.userId), effect: "roster_block" });
  const activeMemberships = options.requireCurrentTeamMembership && entry.teamId
    ? await tx.select({ userId: teamMemberships.userId }).from(teamMemberships).where(and(eq(teamMemberships.teamId, entry.teamId), eq(teamMemberships.status, "active"), isNull(teamMemberships.endedAt), inArray(teamMemberships.userId, rows.map((row) => row.userId))))
    : [];
  const currentTeamIdentity = config.requireTeamLogo && entry.teamId
    ? await tx.select({ logoUrl: teams.logoUrl }).from(teams).where(eq(teams.id, entry.teamId)).limit(1)
    : [];
  let qualification: RosterQualificationResult | null = null;
  if (needsQualificationFacts) {
    const members = rows.map((row) => {
      const userFacts = qualificationFacts.get(row.userId);
      const history = userFacts?.educationHistory ?? [];
      const selected = resolveSeasonEducationVerification(history, affiliationRules).selectedVerification;
      return { userId: row.userId, label: userLabels.get(row.userId) ?? row.userId, emailVerifiedAt: userFacts?.emailVerifiedAt ?? null, educationHistory: history, ...(!v1 ? { isHome: isHomeAffiliatedMember({ institutionCode: selected?.institutionCode ?? null, academicStatus: selected?.academicStatus ?? null }, affiliationRules) } : {}) };
    });
    qualification = await evaluateRosterQualificationFromFacts({
      members,
      facts: qualificationFacts,
      affiliationRules,
      competitiveProfile,
      ...(v1 ? { policy } : {}),
      primaryStarterUserIds: primaryIds,
    });
  }
  const overrides = options.requireActiveRestrictionOverrides
      ? await loadActiveRestrictionOverridesInTx(tx, { competitionId: entry.competitionId, entryIds: [entry.id], rosterRevisionIds: [revision.id] })
      : [];
  const readiness = assessEntryRosterReadiness({
    entry,
    season,
    members: rows.map((row) => ({ userId: row.userId, label: userLabels.get(row.userId) ?? row.userId, primary: row.primary, participantStatus: row.participantStatus })),
    qualificationFindings: (qualification?.findings ?? []).filter((finding) =>
      options.recheckExternalStrength !== false || finding.code !== "external_strength_gap"),
    registrationBlockedUserIds: new Set(registrationBlocks.keys()),
    rosterBlockedUserIds: new Set(rosterBlocks.keys()),
    currentTeamLogoUrl: currentTeamIdentity[0]?.logoUrl ?? null,
    currentTeamMemberUserIds: new Set(activeMemberships.map((membership) => membership.userId)),
    requireCurrentTeamMembership: options.requireCurrentTeamMembership,
    requireActiveRestrictionOverrides: Boolean(options.requireActiveRestrictionOverrides),
    activeRestrictionOverrides: overrides,
  });
  if (readiness.blockers.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, readiness.blockers.join(" "));
  return { revision, rosterSize: readiness.rosterSize, primaryIds, qualification };
}

function rosterCompetitivePurposes(rules: DecodedSeasonRules): CompetitivePurpose[] {
  const participant = rules.roster.legacyParticipant ?? rules.participant;
  const purposes: CompetitivePurpose[] = [];
  if (participant.competitiveProfileRequired) purposes.push("profile_completeness");
  if (participant.rankThreshold?.currentMin || participant.rankThreshold?.peakMin) purposes.push("rank_threshold");
  if (rules.competitive.externalStrengthGap.enabled) purposes.push("external_historical_gap");
  return purposes;
}

/** Assemble authoritative candidate facts under the caller's transaction and locks. */
export async function loadEntryRosterCandidateInTx(
  tx: TxDb,
  input: { entryId: string; expectedRevisionId: string },
): Promise<{ candidate: RosterCandidate; rules: ReturnType<typeof decodeSeasonRules>; season: typeof seasons.$inferSelect }> {
  const entry = await lockEntry(tx, input.entryId);
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  const rules = decodeSeasonRules(season);
  if (entry.currentRosterRevisionId !== input.expectedRevisionId) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "名单版本已变化，请刷新后重试。 ");
  const [revision] = await tx.select().from(competitionEntryRosterRevisions)
    .where(and(eq(competitionEntryRosterRevisions.id, input.expectedRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前名单版本不存在。 ");
  const rows = await tx.select({ userId: competitionEntryRosterMembers.userId, participantId: competitionEntryParticipants.id, participantUserId: competitionEntryParticipants.userId, participantEntryId: competitionEntryParticipants.entryId, declaredPlayerType: competitionEntryParticipants.playerType, teamMembershipId: competitionEntryRosterMembers.teamMembershipId, status: competitionEntryParticipants.status, isPrimaryStarter: competitionEntryRosterMembers.isPrimaryStarter })
    .from(competitionEntryRosterMembers).innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
    .where(eq(competitionEntryRosterMembers.revisionId, revision.id));
  if (rows.some((row) => row.participantEntryId !== entry.id || row.participantUserId !== row.userId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "名单成员记录与参赛队不一致。 ");
  const ids = rows.map((row) => row.userId);
  const profile = rules.competitive.competitiveProfile;
  const purposes = rosterCompetitivePurposes(rules);
  const participantRules = rules.roster.legacyParticipant ?? rules.participant;
  const factsByUser = await loadParticipantQualificationFacts(ids, { executor: tx, includeCompetitiveFacts: purposes.length > 0, platform: profile?.platform, fallbackPlatform: profile?.fallbackConversion?.sourcePlatform, ...(profile ? { competitiveRequirements: deriveCompetitiveRequirements(purposes, profile, participantRules) } : {}) });
  const registrations = await (ids.length ? tx.select({ id: seasonRegistrations.id, userId: seasonRegistrations.userId, status: seasonRegistrations.status, primaryPosition: seasonRegistrations.primaryPosition, playerType: seasonRegistrations.playerType }).from(seasonRegistrations).where(and(eq(seasonRegistrations.seasonId, season.id), inArray(seasonRegistrations.userId, ids))) : []);
  const roles = await (ids.length ? tx.select({ userId: userCompetitiveRoles.userId, role: userCompetitiveRoles.role }).from(userCompetitiveRoles).where(and(inArray(userCompetitiveRoles.userId, ids), eq(userCompetitiveRoles.isPrimary, true))) : []);
  const claims = await (ids.length ? tx.select({ userId: competitionEntryActiveClaims.userId, entryId: competitionEntryActiveClaims.entryId }).from(competitionEntryActiveClaims).where(and(eq(competitionEntryActiveClaims.competitionId, season.id), inArray(competitionEntryActiveClaims.userId, ids))) : []);
  const memberships = await (entry.teamId && ids.length ? tx.select({ id: teamMemberships.id, userId: teamMemberships.userId }).from(teamMemberships).where(and(eq(teamMemberships.teamId, entry.teamId), inArray(teamMemberships.userId, ids), inArray(teamMemberships.status, ["active", "benched"]), isNull(teamMemberships.endedAt))) : []);
  const registrationBlocks = await loadActiveSanctionsInTx(tx, { seasonId: season.id, subjectUserIds: ids, effect: "registration_block" });
  const rosterBlocks = await loadActiveSanctionsInTx(tx, { seasonId: season.id, subjectUserIds: ids, effect: "roster_block" });
  const nameConflicts = await (rules.roster.requireUniqueTeamName ? tx.select({ id: competitionEntries.id }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, season.id), sql`${competitionEntries.id} <> ${entry.id}`, sql`lower(trim(${competitionEntries.name})) = lower(trim(${entry.name}))`, sql`${competitionEntries.registrationStatus} NOT IN ('rejected', 'withdrawn')`)).limit(1) : []);
  const registrationByUser = new Map(registrations.map((registration) => [registration.userId, registration]));
  const rolesByUser = new Map(roles.map((role) => [role.userId, role.role]));
  const playerType = (value: string | null | undefined): PlayerType | null => value === "enrolled" || value === "graduated" || value === "external" ? value : null;
  const members = rows.map((row) => ({
    ...row,
    primaryPosition: registrationByUser.get(row.userId)?.primaryPosition ?? rolesByUser.get(row.userId) ?? null,
    playerType: entry.source === "linked_team" ? playerType(row.declaredPlayerType) : playerType(registrationByUser.get(row.userId)?.playerType),
  }));
  const common = {
    season, revision, factsByUser, currentTeamMemberUserIds: entry.teamId ? new Set(memberships.filter((membership) => members.some((member) => member.userId === membership.userId && member.teamMembershipId === membership.id)).map((membership) => membership.userId)) : null,
    nativeRegistrationsByUser: new Map(registrations.map((registration) => [registration.userId, { id: registration.id, status: registration.status }])),
    activeClaimEntryByUser: new Map(claims.map((claim) => [claim.userId, claim.entryId])),
    registrationBlockedUserIds: new Set(registrationBlocks.keys()), rosterBlockedUserIds: new Set(rosterBlocks.keys()),
  };
  const entryFacts = { ...entry, logoPresent: Boolean(entry.logoUrl), nameConflicts: nameConflicts.length > 0 };
  if (entry.source === "event_native") {
    if (members.some((member) => member.teamMembershipId !== null)) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事原生名单不能关联长期队伍成员记录。 ");
    return { season, rules, candidate: { ...common, entry: { ...entryFacts, source: "event_native" }, members: members.map((member) => ({ ...member, teamMembershipId: null })) } };
  }
  return { season, rules, candidate: { ...common, entry: { ...entryFacts, source: "linked_team" }, members } };
}

/** Transaction-scoped evidence to pass directly to the roster freezing owner. */
export type EntryRosterAssessment = {
  candidate: RosterCandidate;
  rules: DecodedSeasonRules;
  evidence: QualificationEvidence;
  participantDecisions: ReadonlyMap<string, QualificationDecision>;
  rosterDecision: QualificationDecision;
  decisions: readonly QualificationDecision[];
  findings: readonly import("@/lib/qualification/finding").QualificationFinding[];
  decision: QualificationDecision;
  approvedOverrides: readonly (typeof competitionEntryRestrictionOverrides.$inferSelect)[];
};

/** Always load and evaluate fresh facts inside the caller's transaction. */
export async function assessEntryRosterInTx(tx: TxDb, input: { entryId: string; expectedRevisionId: string }): Promise<EntryRosterAssessment> {
  const { candidate, rules } = await loadEntryRosterCandidateInTx(tx, input);
  const participantRules = rules.roster.legacyParticipant ?? rules.participant;
  const purposes = rosterCompetitivePurposes(rules);
  const profile = rules.competitive.competitiveProfile;
  const evidence: QualificationEvidence = profile ? buildQualificationEvidence(candidate.factsByUser, profile, participantRules, purposes) : { kind: "none" };
  const participantDecisions = new Map<string, QualificationDecision>();
  for (const member of candidate.members) {
    const facts = candidate.factsByUser.get(member.userId);
    participantDecisions.set(member.userId, facts ? evaluateParticipant({ userId: member.userId, facts, playerType: member.playerType }, participantRules, evidence) : { state: "blocked", findings: [{ code: "participant_missing", message: "名单成员资料不可用。", waivable: false, metadata: { userId: member.userId } }] });
  }
  const rosterDecision = evaluateRoster(candidate, rules, evidence);
  const decisions = [rosterDecision, ...candidate.members.map((member) => participantDecisions.get(member.userId)!)];
  const findings = uniqueQualificationFindings(decisions.flatMap((result) => [...result.findings]));
  const approvedOverrides = await loadActiveRestrictionOverridesInTx(tx, { competitionId: candidate.entry.competitionId, entryIds: [candidate.entry.id], rosterRevisionIds: [candidate.revision.id] });
  const unresolved = unresolvedQualificationFindings(findings, approvedOverrides);
  const decision: QualificationDecision = unresolved.length ? { state: "blocked", findings: [unresolved[0], ...unresolved.slice(1)] } : { state: "ready", findings: [] };
  return { candidate, rules, evidence, participantDecisions, rosterDecision, decisions, findings, decision, approvedOverrides };
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
  options: { recheckExternalStrength?: boolean } = {},
) {
  if (entry.registrationStatus !== "approved" || !entry.approvedRosterRevisionId || entry.currentRosterRevisionId !== entry.approvedRosterRevisionId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "只能选择当前报名已通过审核且名单记录完整的队伍。 ");
  }
  return validateEntryRosterInTx(tx, entry, season, ["approved"], {
    requireCurrentTeamMembership: false,
    requireActiveRestrictionOverrides: true,
    ...options,
  });
}

export async function createCompetitionEntryInTx(tx: TxDb, input: { competitionId: string; teamId: string; userId: string; actorId: string }): Promise<{ entryId: string; seasonSlug: string }> {
  let season = await loadSeasonOrThrow(tx, input.competitionId);
  if (!isTeamRegistration(season)) throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前赛事不使用队伍报名。");
  const [teamScope] = await tx.select({ status: teams.status, captainUserId: teams.captainUserId }).from(teams).where(eq(teams.id, input.teamId));
  if (!teamScope || teamScope.status !== "active") throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在或已解散。");
  if (teamScope.captainUserId !== input.userId) throw new AppError(ErrorCode.FORBIDDEN, "只有队伍队长可以创建参赛条目。");
  if (getRegistrationWindowState(season).needsOpeningRecovery) {
    season = (await ensureRegistrationOpenForParticipantInTx(tx, input.competitionId)).season;
  }
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

export async function saveCompetitionEntryRosterInTx(tx: TxDb, input: { entryId: string; userIds: string[]; primaryStarterUserIds: string[]; perfectTeamId?: string | null; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const perfectTeamId = normalizePerfectTeamId(input.perfectTeamId);
  if (input.perfectTeamId !== null && input.perfectTeamId !== undefined && input.perfectTeamId !== "" && perfectTeamId === null) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "完美战队 ID 只能包含数字。");
  }
  const entry = await lockRepresentativeEntry(tx, input.entryId, input.userId);
  await assertRosterNotFrozen(tx, entry.id);
  if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名版本不可编辑。");
  if (!entry.teamId) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事组队报名不能通过队伍名单编辑入口修改。");
  let season = await loadSeasonOrThrow(tx, entry.competitionId);
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision || revision.status !== "draft") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前名单版本不可编辑。");
  if (revision.origin !== "admin_remediation" && getRegistrationWindowState(season).needsOpeningRecovery) {
    season = (await ensureRegistrationOpenForParticipantInTx(tx, entry.competitionId)).season;
  }
  const currentMemberships = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, entry.teamId), inArray(teamMemberships.userId, input.userIds), inArray(teamMemberships.status, ["active", "benched"]), isNull(teamMemberships.endedAt)));
  if (currentMemberships.length !== input.userIds.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "新选择的名单成员必须当前仍属于这支队伍。");
  const window = getRegistrationWindowState(season);
  if ((revision.origin === "self_roster_change" && decodeSeasonRules(season).roster.changes?.selfServiceAfterApproval === false) || !canMutateCompetitionEntryRoster(entry.registrationStatus as "draft" | "changes_requested", revision.origin, season, new Date(), await canSelfAdjustMajorRosterInTx(tx, season, entry.id))) throw new AppError(ErrorCode.REGISTRATION_CLOSED, revision.origin === "self_roster_change" ? "名单调整窗口当前不可用；请联系赛委会。" : window.message);
  const existingParticipants = await tx.select().from(competitionEntryParticipants).where(eq(competitionEntryParticipants.entryId, entry.id));
  const selected = new Set(input.userIds);
  const confirmedRemoved = existingParticipants.filter((participant) => participant.status === "confirmed" && !selected.has(participant.userId));
  if (!selected.has(entry.representativeUserId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先交接赛事负责人，再从本届名单移除自己。");
  if (confirmedRemoved.length > 0 && decodeSeasonRules(season).roster.changes?.representativeCanRemove === false) throw new AppError(ErrorCode.FORBIDDEN, "本届赛事不允许负责人移除已确认成员，请联系赛事管理员。");
  if (confirmedRemoved.length > 0 && revision.origin !== "self_roster_change") throw new AppError(ErrorCode.VALIDATION_FAILED, "已确认参赛的成员请先执行赛事退出；审核通过后的换人请发起名单变更。");
  for (const participant of confirmedRemoved) {
    const now = new Date();
    await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.participantId, participant.id));
    await tx.update(competitionEntryParticipants).set({ status: "withdrawn", withdrawnAt: now, updatedAt: now }).where(eq(competitionEntryParticipants.id, participant.id));
    await auditEntry(tx, { action: "competition_entry.participant.remove", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: participant.userId, source: "representative_roster_change", revisionId: revision.id } });
  }
  const participantByUser = new Map(existingParticipants.map((row) => [row.userId, row]));
  for (const userId of input.userIds) {
    const existing = participantByUser.get(userId);
    if (!existing) {
      const [created] = await tx.insert(competitionEntryParticipants).values({ entryId: entry.id, userId, invitedByUserId: input.userId, status: "invited" }).returning();
      participantByUser.set(userId, created);
    } else if (existing.status === "declined" || existing.status === "withdrawn") {
      const reinvitedAt = new Date();
      await tx.update(competitionEntryParticipants).set({ status: "invited", invitedByUserId: input.userId, playerType: null, confirmedAt: null, withdrawnAt: null, updatedAt: reinvitedAt }).where(eq(competitionEntryParticipants.id, existing.id));
      participantByUser.set(userId, { ...existing, status: "invited", invitedByUserId: input.userId, playerType: null, confirmedAt: null, withdrawnAt: null, updatedAt: reinvitedAt });
      await auditEntry(tx, { action: "competition_entry.participant.reinvite", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: existing.id, userId, previousStatus: existing.status } });
    }
  }
  await tx.delete(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, revision.id));
  await tx.insert(competitionEntryRosterMembers).values(input.userIds.map((userId) => ({ revisionId: revision.id, participantId: participantByUser.get(userId)!.id, userId, teamMembershipId: currentMemberships.find((row) => row.userId === userId)?.id ?? null, isPrimaryStarter: input.primaryStarterUserIds.includes(userId) })));
  const [teamIdentity] = !entry.logoUrl ? await tx.select({ logoUrl: teams.logoUrl }).from(teams).where(eq(teams.id, entry.teamId)) : [];
  await tx.update(competitionEntries).set({ perfectTeamId, ...(!entry.logoUrl && teamIdentity?.logoUrl ? { logoUrl: teamIdentity.logoUrl } : {}), updatedAt: new Date() }).where(eq(competitionEntries.id, entry.id));
  await auditEntry(tx, { action: "competition_entry.roster.save", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { revision: revision.revisionNumber, rosterSize: input.userIds.length, primaryStarterCount: input.primaryStarterUserIds.length } });
  return { seasonSlug: season.slug };
}

/** Reopen an approved roster and add one current team member in the same transaction. */
export async function addCompetitionEntryRosterMemberInTx(tx: TxDb, input: { entryId: string; memberUserId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const [scope] = await tx.select({ competitionId: competitionEntries.competitionId }).from(competitionEntries).where(eq(competitionEntries.id, input.entryId));
  if (!scope) throw new AppError(ErrorCode.NOT_FOUND, "未找到本届报名。");
  await tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, scope.competitionId)).for("update");
  let entry = await lockRepresentativeEntry(tx, input.entryId, input.userId);
  if (entry.registrationStatus === "approved") {
    await requestCompetitionEntryRosterChangeInTx(tx, { entryId: entry.id, representativeUserId: input.userId, actorId: input.actorId });
    entry = await lockRepresentativeEntry(tx, entry.id, input.userId);
  }
  const members = await tx.select().from(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, entry.currentRosterRevisionId));
  const userIds = [...new Set([...members.map(member => member.userId), input.memberUserId])];
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  if (userIds.length > season.maxTeamSize) throw new AppError(ErrorCode.VALIDATION_FAILED, `本届名单最多 ${season.maxTeamSize} 人，请先调整名单。`);
  return saveCompetitionEntryRosterInTx(tx, { entryId: entry.id, userId: input.userId, actorId: input.actorId, userIds, primaryStarterUserIds: members.filter(member => member.isPrimaryStarter).map(member => member.userId), perfectTeamId: entry.perfectTeamId });
}

/** The player explicitly accepts a target invitation and releases an eliminated entry atomically. */
export async function transferCompetitionEntryParticipationInTx(tx: TxDb, input: { entryId: string; fromEntryId: string; userId: string; actorId: string; playerType?: PlayerType | null }): Promise<{ seasonSlug: string }> {
  const [target] = await tx.select().from(competitionEntries).where(eq(competitionEntries.id, input.entryId));
  if (!target || target.id === input.fromEntryId) throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择新的参赛队伍。");
  const [source] = await tx.select({ competitionId: competitionEntries.competitionId }).from(competitionEntries).where(eq(competitionEntries.id, input.fromEntryId));
  if (!source || source.competitionId !== target.competitionId) throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择同一届赛事的参赛队伍。");
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, target.competitionId)).for("update");
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
  await tx.execute(sql`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`);
  for (const id of [input.entryId, input.fromEntryId].sort()) await lockEntry(tx, id);
  const [claim] = await tx.select().from(competitionEntryActiveClaims).where(and(eq(competitionEntryActiveClaims.competitionId, season.id), eq(competitionEntryActiveClaims.userId, input.userId))).for("update");
  if (!claim || claim.entryId !== input.fromEntryId) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "你的参赛队伍已变化，请刷新页面后重试。");
  if (!await canReleaseEliminatedParticipationInTx(tx, season, claim.entryId)) throw new AppError(ErrorCode.REGISTRATION_CLOSED, "原队伍当前不允许自行转出，请联系赛委会。");
  if (!await canSelfAdjustMajorRosterInTx(tx, season, target.id)) throw new AppError(ErrorCode.REGISTRATION_CLOSED, "新队当前不能调整本届名单，请联系赛委会。");
  const [invitation] = await tx.select({ status: competitionEntryParticipants.status }).from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, target.id), eq(competitionEntryParticipants.userId, input.userId))).for("update");
  if (invitation?.status !== "invited") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "新队邀请已更新，请刷新页面后重试。");
  if (target.teamId) {
    const [membership] = await tx.select({ id: teamMemberships.id }).from(teamMemberships).where(and(eq(teamMemberships.teamId, target.teamId), eq(teamMemberships.userId, input.userId), inArray(teamMemberships.status, ["active", "benched"]), isNull(teamMemberships.endedAt)));
    if (!membership) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先加入新队伍，再确认本届参赛。");
  }
  await withdrawCompetitionEntryParticipationInTx(tx, { entryId: claim.entryId, userId: input.userId, actorId: input.actorId });
  await confirmCompetitionEntryParticipationInTx(tx, input);
  return { seasonSlug: season.slug };
}

export async function confirmCompetitionEntryParticipationInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string; playerType?: PlayerType | null }): Promise<{ seasonSlug: string; alreadyConfirmed: boolean }> {
  await lockEntrySeason(tx, input.entryId);
  await tx.execute(sql`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`);
  const entry = await lockEntry(tx, input.entryId);
  await assertRosterNotFrozen(tx, entry.id);
  if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名阶段不能确认新成员。");
  const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, input.userId))).for("update");
  if (!participant) throw new AppError(ErrorCode.NOT_FOUND, "你不在当前本届名单中。");
  let season = await loadSeasonOrThrow(tx, entry.competitionId);
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision || revision.status !== "draft") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前名单版本不可编辑。");
  const [rosterMember] = await tx.select({ id: competitionEntryRosterMembers.id }).from(competitionEntryRosterMembers).where(and(eq(competitionEntryRosterMembers.revisionId, revision.id), eq(competitionEntryRosterMembers.participantId, participant.id)));
  if (!rosterMember) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "邀请已更新，请联系赛事负责人确认当前名单。");
  const nativeFormation = entry.source === "event_native" && season.registrationMode === "solo"
    && ((entry.registrationStatus === "draft" && revision.origin === "initial") || (entry.registrationStatus === "changes_requested" && revision.origin === "self_roster_change" && decodeSeasonRules(season).source === "policy_v2"))
    && (season.status === "registration" || season.status === "drafting");
  if (nativeFormation) {
    if (revision.origin === "self_roster_change" && (decodeSeasonRules(season).roster.changes?.selfServiceAfterApproval === false || !canSelfChangeApprovedRoster(season.status === "drafting" ? { ...season, status: "registration", registrationClosesAt: null } : season) || !await canSelfAdjustMajorRosterInTx(tx, season, entry.id))) throw new AppError(ErrorCode.REGISTRATION_CLOSED, "名单调整窗口当前不可用；请联系赛事管理员。");
    const [registration] = await tx.select({ status: seasonRegistrations.status }).from(seasonRegistrations)
      .where(and(eq(seasonRegistrations.seasonId, season.id), eq(seasonRegistrations.userId, input.userId)));
    if (registration?.status !== "approved") throw new AppError(ErrorCode.VALIDATION_FAILED, "只有已通过个人报名审核的选手可以确认本届编队。 ");
  } else {
    if (revision.origin !== "admin_remediation" && getRegistrationWindowState(season).needsOpeningRecovery) {
      season = (await ensureRegistrationOpenForParticipantInTx(tx, entry.competitionId)).season;
    }
    const window = getRegistrationWindowState(season);
    if ((revision.origin === "self_roster_change" && decodeSeasonRules(season).roster.changes?.selfServiceAfterApproval === false) || !canMutateCompetitionEntryRoster(entry.registrationStatus as "draft" | "changes_requested", revision.origin, season, new Date(), await canSelfAdjustMajorRosterInTx(tx, season, entry.id))) throw new AppError(ErrorCode.REGISTRATION_CLOSED, revision.origin === "self_roster_change" ? "名单调整窗口当前不可用；请联系赛委会。" : window.message);
  }
  const registrationBlocks = await loadActiveSanctionsInTx(tx, { seasonId: season.id, subjectUserIds: [input.userId], effect: "registration_block" });
  const rosterBlocks = await loadActiveSanctionsInTx(tx, { seasonId: season.id, subjectUserIds: [input.userId], effect: "roster_block" });
  if (registrationBlocks.has(input.userId) || rosterBlocks.has(input.userId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前参赛限制阻止你确认本届名单，请联系赛事管理员。 ");
  const rules = decodeSeasonRules(season);
  const declaration = entry.source === "linked_team" && rules.source === "policy_v2"
    ? input.playerType ?? participant.playerType : participant.playerType;
  if (entry.source === "linked_team" && rules.source === "policy_v2") {
    const allowed = rules.participant.allowedPlayerTypes;
    const allTypesAllowed = allowed && (["enrolled", "graduated", "external"] as const).every((type) => allowed.includes(type));
    if (allowed && !allTypesAllowed && !declaration) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先选择你本人本届参赛身份。 ");
    if (allowed && declaration && !allowed.includes(declaration)) throw new AppError(ErrorCode.VALIDATION_FAILED, "所选参赛身份不符合本届赛事要求。 ");
  }
  const alreadyConfirmed = participant.status === "confirmed";
  if (!alreadyConfirmed && participant.status !== "invited") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前成员状态不能确认参赛。");
  const [claim] = await tx.insert(competitionEntryActiveClaims).values({ competitionId: entry.competitionId, userId: input.userId, entryId: entry.id, participantId: participant.id }).onConflictDoNothing().returning({ entryId: competitionEntryActiveClaims.entryId });
  if (!claim) {
    const existing = await tx.query.competitionEntryActiveClaims.findFirst({ where: and(eq(competitionEntryActiveClaims.competitionId, entry.competitionId), eq(competitionEntryActiveClaims.userId, input.userId)) });
    if (!existing || existing.entryId !== entry.id) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "你已确认代表本届赛事的另一支队伍。");
  }
  if (alreadyConfirmed && declaration === participant.playerType) return { seasonSlug: season.slug, alreadyConfirmed: true };
  await tx.update(competitionEntryParticipants).set({ status: "confirmed", playerType: declaration, confirmedAt: participant.confirmedAt ?? new Date(), updatedAt: new Date() }).where(eq(competitionEntryParticipants.id, participant.id));
  await auditEntry(tx, { action: "competition_entry.participant.confirm", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: input.userId, revisionId: revision.id, playerType: declaration, previousPlayerType: participant.playerType } });
  return { seasonSlug: season.slug, alreadyConfirmed };
}

export async function withdrawCompetitionEntryParticipationInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  // Approved self-withdrawal reuses the representative's canonical roster-change
  // transition. Do not lock Entry before calling it: that transition locks the
  // season first, so preserving season → Entry avoids a cross-flow deadlock.
  const [entryScope] = await tx.select({
    competitionId: competitionEntries.competitionId,
    representativeUserId: competitionEntries.representativeUserId,
    registrationStatus: competitionEntries.registrationStatus,
  }).from(competitionEntries).where(eq(competitionEntries.id, input.entryId));
  if (!entryScope) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
  const [withdrawalSeason] = await tx.select().from(seasons).where(eq(seasons.id, entryScope.competitionId)).for("update");
  if (!withdrawalSeason) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
  if (await canReleaseEliminatedParticipationInTx(tx, withdrawalSeason, input.entryId)) {
    const entry = await lockEntry(tx, input.entryId);
    const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, input.userId))).for("update");
    if (!participant || participant.status !== "confirmed") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前没有可退出的已确认承诺。");
    await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.participantId, participant.id));
    const now = new Date();
    await tx.update(competitionEntryParticipants).set({ status: "withdrawn", withdrawnAt: now, updatedAt: now }).where(eq(competitionEntryParticipants.id, participant.id));
    await auditEntry(tx, { action: "competition_entry.participant.withdraw", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: input.userId, source: "eliminated_self_withdrawal" } });
    return { seasonSlug: withdrawalSeason.slug };
  }
  if (entryScope.representativeUserId === input.userId) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先将赛事负责人交接给另一位已确认成员，再退出本届赛事。");
  const startsRosterChange = entryScope.registrationStatus === "approved";
  if (startsRosterChange) {
    await requestCompetitionEntryRosterChangeInTx(tx, {
      entryId: input.entryId,
      representativeUserId: entryScope.representativeUserId,
      actorId: input.actorId,
      source: "participant_self_withdrawal",
    });
  }

  const entry = await lockEntry(tx, input.entryId);
  await assertRosterNotFrozen(tx, entry.id);
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  if (!await canSelfAdjustMajorRosterInTx(tx, season, entry.id)) throw new AppError(ErrorCode.REGISTRATION_CLOSED, "当前阶段不能自行调整名单；请联系赛事管理员处理。");
  const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, input.userId))).for("update");
  if (!participant || participant.status !== "confirmed") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前没有可退出的已确认承诺。");
  if (entry.representativeUserId === input.userId) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先将赛事负责人交接给另一位已确认成员，再退出本届赛事。");
  let selfRosterChangeRevisionId: string | null = null;
  if (entry.registrationStatus === "approved") {
    throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "已通过审核的名单暂时不能退出，请刷新后重试或联系赛事管理员。");
  }
  if (startsRosterChange || entry.registrationStatus === "changes_requested") {
    const [revision] = await tx.select().from(competitionEntryRosterRevisions)
      .where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id)))
      .for("update");
    if (revision?.status === "draft" && revision.origin === "self_roster_change") {
      const season = await loadSeasonOrThrow(tx, entry.competitionId);
      if (decodeSeasonRules(season).roster.changes?.selfServiceAfterApproval === false || !canSelfChangeApprovedRoster(season.status === "drafting" && entry.source === "event_native" && decodeSeasonRules(season).source === "policy_v2" ? { ...season, status: "registration", registrationClosesAt: null } : season) || !await canSelfAdjustMajorRosterInTx(tx, season, entry.id)) throw new AppError(ErrorCode.REGISTRATION_CLOSED, "名单调整窗口当前不可用；请联系赛事管理员处理。");
      selfRosterChangeRevisionId = revision.id;
    }
  }
  await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.participantId, participant.id));
  const now = new Date();
  await tx.update(competitionEntryParticipants).set({ status: "withdrawn", withdrawnAt: now, updatedAt: now }).where(eq(competitionEntryParticipants.id, participant.id));
  if (selfRosterChangeRevisionId) {
    await tx.delete(competitionEntryRosterMembers).where(and(
      eq(competitionEntryRosterMembers.revisionId, selfRosterChangeRevisionId),
      eq(competitionEntryRosterMembers.participantId, participant.id),
    ));
  }
  await auditEntry(tx, {
    action: "competition_entry.participant.withdraw",
    actorId: input.actorId,
    entryId: entry.id,
    competitionId: entry.competitionId,
    meta: { participantId: participant.id, userId: input.userId, source: "participant_self_withdrawal", ...(selfRosterChangeRevisionId ? { revisionId: selfRosterChangeRevisionId } : {}) },
  });
  return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
}

export async function declineCompetitionEntryParticipationInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockEntry(tx, input.entryId);
  await assertRosterNotFrozen(tx, entry.id);
  if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名阶段不能拒绝邀请。");
  const [participant] = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, input.userId))).for("update");
  if (!participant || participant.status !== "invited") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前没有可拒绝的本届参赛邀请。");
  await tx.update(competitionEntryParticipants).set({ status: "declined", updatedAt: new Date() }).where(eq(competitionEntryParticipants.id, participant.id));
  await auditEntry(tx, { action: "competition_entry.participant.decline", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { participantId: participant.id, userId: input.userId } });
  return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
}

export async function withdrawCompetitionEntryFromReviewInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockRepresentativeEntry(tx, input.entryId, input.userId);
  await assertRosterNotFrozen(tx, entry.id);
  if (entry.registrationStatus !== "submitted") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有已提交审核的报名可以撤回审核。");
  const [revision] = await tx.select().from(competitionEntryRosterRevisions)
    .where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id)))
    .for("update");
  if (!revision || revision.status !== "submitted") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前名单版本不在审核中。");
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  const window = getRegistrationWindowState(season);
  if (!window.canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, window.message);
  const next = await cloneRosterRevisionAsDraftInTx(tx, revision, input.actorId);
  const now = new Date();
  await tx.update(competitionEntries).set({
    registrationStatus: "draft",
    currentRosterRevisionId: next.id,
    submittedAt: null,
    reviewedAt: null,
    reviewReason: null,
    updatedAt: now,
  }).where(eq(competitionEntries.id, entry.id));
  await auditEntry(tx, {
    action: "competition_entry.review.withdraw",
    actorId: input.actorId,
    entryId: entry.id,
    competitionId: entry.competitionId,
    meta: { from: "submitted", to: "draft", submittedRevision: revision.revisionNumber, nextRevision: next.revisionNumber },
  });
  return { seasonSlug: season.slug };
}

export async function submitCompetitionEntryInTx(tx: TxDb, input: { entryId: string; userId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockRepresentativeEntry(tx, input.entryId, input.userId);
  await assertRosterNotFrozen(tx, entry.id);
  if (!editableStatuses.includes(entry.registrationStatus as typeof editableStatuses[number])) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前报名状态不能提交。");
  let season = await loadSeasonOrThrow(tx, entry.competitionId);
  const [currentRevision] = await tx.select({ origin: competitionEntryRosterRevisions.origin }).from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!currentRevision) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前名单版本不可用于此操作。");
  if (currentRevision.origin !== "admin_remediation" && getRegistrationWindowState(season).needsOpeningRecovery) {
    season = (await ensureRegistrationOpenForParticipantInTx(tx, entry.competitionId)).season;
  }
  const window = getRegistrationWindowState(season);
  const validated = await validateEntryRosterInTx(tx, entry, season, ["draft"], { requireCurrentTeamMembership: true, requireActiveRestrictionOverrides: false });
  if ((validated.revision.origin === "self_roster_change" && decodeSeasonRules(season).roster.changes?.selfServiceAfterApproval === false) || !canMutateCompetitionEntryRoster(entry.registrationStatus as "draft" | "changes_requested", validated.revision.origin, season, new Date(), await canSelfAdjustMajorRosterInTx(tx, season, entry.id))) throw new AppError(ErrorCode.REGISTRATION_CLOSED, validated.revision.origin === "self_roster_change" ? "名单调整窗口当前不可用；请联系赛委会。" : window.message);
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
    throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有已提交或候补的报名可以解除资格限制。");
  }
  const reason = input.reason.trim();
  const restrictionCode = input.restrictionCode.trim();
  if (!reason || !restrictionCode) throw new AppError(ErrorCode.VALIDATION_FAILED, "解除限制必须填写具体限制和非空理由。 ");
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  const validated = await validateEntryRosterInTx(tx, entry, season, ["submitted"], {
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
    throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有待审核或候补的报名可以撤销解除限制。");
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

/** Reassess and approve the current submitted revision in the same transaction. */
async function approveRosterRevisionInTx(
  tx: TxDb,
  entry: typeof competitionEntries.$inferSelect,
  season: typeof seasons.$inferSelect,
  now: Date,
  allowedRevisionStatuses: readonly ("draft" | "submitted" | "approved")[] = ["submitted"],
) {
  const candidate = await validateEntryRosterInTx(tx, entry, season, allowedRevisionStatuses, {
    requireCurrentTeamMembership: false,
    requireActiveRestrictionOverrides: true,
  });
  await tx.update(competitionEntryRosterRevisions).set({ status: "approved", approvedAt: now })
    .where(eq(competitionEntryRosterRevisions.id, candidate.revision.id));
  const assessment = "assessment" in candidate ? candidate.assessment : null;
  if (!assessment) return { revision: candidate.revision, assessment: null };
  const roster = assessment.candidate;
  const approvedCandidate: RosterCandidate = roster.entry.source === "event_native"
    ? { ...roster, entry: { ...roster.entry, source: "event_native", registrationStatus: "approved", approvedRosterRevisionId: candidate.revision.id }, members: roster.members.map((member) => ({ ...member, teamMembershipId: null })), revision: { ...roster.revision, status: "approved" } }
    : { ...roster, entry: { ...roster.entry, source: "linked_team", approvedRosterRevisionId: candidate.revision.id }, revision: { ...roster.revision, status: "approved" } };
  return { revision: candidate.revision, assessment: { ...assessment, candidate: approvedCandidate } };
}

/** Adopt a completed event-native roster, without manufacturing a team submission.
 * The caller must authorize the operation and owns downstream reconciliation.
 * Facts and qualification are loaded afresh under the transaction's locks.
 */
export async function adoptEventNativeRosterInTx(
  tx: TxDb,
  input: { entryId: string; expectedRevisionId: string; actorId: string },
): Promise<{ seasonId: string; seasonSlug: string; revisionId: string; alreadyApproved: boolean; assessment: EntryRosterAssessment | null }> {
  const entry = await lockEntry(tx, input.entryId);
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  if (entry.source !== "event_native" || !["draft", "approved"].includes(entry.registrationStatus) && !(entry.registrationStatus === "changes_requested" && decodeSeasonRules(season).source === "policy_v2")) {
    throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前赛事原生参赛队不能采用名单。 ");
  }
  if (entry.currentRosterRevisionId !== input.expectedRevisionId) {
    throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "名单版本已变化，请刷新后重试。 ");
  }
  const [revision] = await tx.select().from(competitionEntryRosterRevisions)
    .where(and(eq(competitionEntryRosterRevisions.id, input.expectedRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前名单版本不存在。 ");
  if (entry.approvedRosterRevisionId === revision.id && revision.status === "approved") {
    const assessment = decodeSeasonRules(season).source === "policy_v2" ? await assessEntryRosterInTx(tx, input) : null;
    if (assessment?.decision.state === "blocked") throw new AppError(ErrorCode.VALIDATION_FAILED, assessment.decision.findings.map((finding) => finding.message).join(" "));
    return { seasonId: season.id, seasonSlug: season.slug, revisionId: revision.id, alreadyApproved: true, assessment };
  }
  if (revision.status !== "draft") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "当前名单版本不能采用。 ");
  await assertRosterNotFrozen(tx, entry.id);
  const now = new Date();
  const { assessment } = await approveRosterRevisionInTx(tx, entry, season, now, ["draft"]);
  await tx.update(competitionEntries).set({ registrationStatus: "approved", approvedRosterRevisionId: revision.id, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
  await auditEntry(tx, { action: "competition_entry.approved", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { rosterRevision: revision.revisionNumber, source: entry.source } });
  return { seasonId: season.id, seasonSlug: season.slug, revisionId: revision.id, alreadyApproved: false, assessment };
}

export async function applyEntryReviewDecisionInTx(tx: TxDb, input: { entryId: string; decision: "changes_requested" | "waitlisted" | "approved" | "rejected"; reason?: string; actorId: string }): Promise<{ seasonSlug: string; seasonId: string; from: typeof competitionEntries.$inferSelect.registrationStatus; rosterRevision: number; assessment: EntryRosterAssessment | null }> {
  const [entryScope] = await tx.select({ competitionId: competitionEntries.competitionId })
    .from(competitionEntries).where(eq(competitionEntries.id, input.entryId));
  if (!entryScope) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, entryScope.competitionId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。 ");
  const entry = await lockEntry(tx, input.entryId);
  if (!["submitted", "waitlisted"].includes(entry.registrationStatus)) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有已提交或候补的报名可以审核。");
  const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!revision) throw new AppError(ErrorCode.INTERNAL_ERROR, "报名名单记录不完整，请联系赛事管理员。");
  const [submission] = await tx.select().from(competitionEntrySubmissions).where(and(eq(competitionEntrySubmissions.entryId, entry.id), eq(competitionEntrySubmissions.rosterRevisionId, revision.id))).for("update");
  if (!submission) throw new AppError(ErrorCode.INTERNAL_ERROR, "报名提交记录不完整，请联系赛事管理员。");
  const now = new Date();
  const assessment = input.decision === "approved" ? (await approveRosterRevisionInTx(tx, entry, season, now)).assessment : null;
  await tx.update(competitionEntrySubmissions).set({ decision: input.decision, decidedBy: input.actorId, decidedAt: now, reason: input.reason || null }).where(eq(competitionEntrySubmissions.id, submission.id));
  if (input.decision === "changes_requested") {
    const next = await cloneRosterRevisionAsDraftInTx(tx, revision, input.actorId, "admin_remediation");
    await tx.update(competitionEntries).set({ registrationStatus: "changes_requested", currentRosterRevisionId: next.id, reviewedAt: now, reviewReason: input.reason, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
  } else {
    await tx.update(competitionEntries).set({ registrationStatus: input.decision, approvedRosterRevisionId: input.decision === "approved" ? revision.id : entry.approvedRosterRevisionId, reviewedAt: now, reviewReason: input.reason || null, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
    if (input.decision === "rejected") await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.entryId, entry.id));
  }
  return { seasonSlug: season.slug, seasonId: season.id, from: entry.registrationStatus, rosterRevision: revision.revisionNumber, assessment };
}

export async function transferCompetitionEntryRepresentativeInTx(tx: TxDb, input: { entryId: string; userId: string; toUserId: string; actorId: string }): Promise<{ seasonSlug: string }> {
  const entry = await lockRepresentativeEntry(tx, input.entryId, input.userId);
  await assertRosterNotFrozen(tx, entry.id);
  const season = await loadSeasonOrThrow(tx, entry.competitionId);
  if (decodeSeasonRules(season).roster.changes?.representativeCanTransfer === false) throw new AppError(ErrorCode.FORBIDDEN, "本届赛事不允许负责人自行交接，请联系赛事管理员。");
  const [participant] = await tx.select().from(competitionEntryParticipants)
    .where(and(eq(competitionEntryParticipants.entryId, entry.id), eq(competitionEntryParticipants.userId, input.toUserId))).for("update");
  if (!participant || participant.status !== "confirmed") throw new AppError(ErrorCode.VALIDATION_FAILED, "新赛事负责人必须是本届已确认参赛的成员。");
  if (decodeSeasonRules(season).source === "policy_v2") {
    const [rosterMember] = await tx.select({ id: competitionEntryRosterMembers.id }).from(competitionEntryRosterMembers)
      .where(and(eq(competitionEntryRosterMembers.revisionId, entry.currentRosterRevisionId), eq(competitionEntryRosterMembers.participantId, participant.id), eq(competitionEntryRosterMembers.userId, participant.userId)));
    if (!rosterMember) throw new AppError(ErrorCode.VALIDATION_FAILED, "新赛事负责人必须在当前名单中。 ");
  }
  const now = new Date();
  await tx.insert(competitionEntryRepresentativeChanges).values({ entryId: entry.id, fromUserId: entry.representativeUserId, toUserId: input.toUserId, changedAt: await nextRepresentativeChangeAt(tx, entry.id), changedByActorId: input.actorId });
  await tx.update(competitionEntries).set({ representativeUserId: input.toUserId, updatedAt: now }).where(eq(competitionEntries.id, entry.id));
  await auditEntry(tx, { action: "competition_entry.representative.transfer", actorId: input.actorId, entryId: entry.id, competitionId: entry.competitionId, meta: { fromUserId: entry.representativeUserId, toUserId: input.toUserId } });
  return { seasonSlug: (await loadSeasonOrThrow(tx, entry.competitionId)).slug };
}
