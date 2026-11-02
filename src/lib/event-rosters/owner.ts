import "server-only";

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  competitionEntryParticipants,
  competitionEntryRosterMembers,
  eventRosterMembers,
  eventRosters,
  matchRosterPlayers,
  matchRosters,
  matches,
  seasons,
} from "@/db/schema";
import { assessEntryRosterInTx, type EntryRosterAssessment } from "@/lib/competition-entries/commands";
import { writeAuditInTx } from "@/lib/audit/write";
import { unresolvedQualificationFindings } from "@/lib/competition-entries/restriction-overrides";
import { decodeFrozenLineupEligibility } from "@/lib/match-rosters/frozen-eligibility";
import { decodeEventRosterEligibilitySnapshotV2, eventRosterEligibilitySnapshotV2Schema } from "@/lib/seasons/eligibility-snapshot";
import { AppError, ErrorCode } from "@/lib/errors";
import { evaluateRosterEducationEligibility, resolveSeasonEducationVerification } from "@/lib/education/eligibility";
import { getDisplayName } from "@/lib/identity/display-name";
import { assertSinglePrestartEntryCoherenceInTx, type PrestartEntryCoherence } from "@/lib/event-rosters/coherence";
import { loadParticipantQualificationFacts } from "@/lib/qualification/service";
import { freezeQualificationRosterInTx } from "@/lib/competition-qualification/eligibility";
import { resolveQualificationPolicy } from "@/lib/seasons/compatibility";

export async function loadApprovedRosterEducation(
  tx: TxDb,
  userIds: readonly string[],
  affiliationRules: Parameters<typeof evaluateRosterEducationEligibility>[1],
  policy?: import("@/types/season").QualificationPolicyV1,
): Promise<Map<string, string>> {
  const facts = await loadParticipantQualificationFacts(userIds, { executor: tx, includeCompetitiveFacts: false });
  if (facts.size !== new Set(userIds).size) throw new AppError(ErrorCode.VALIDATION_FAILED, "名单中存在无法核验的选手账号。");
  const resolved = [...facts.entries()].map(([userId, fact]) => ({
    userId,
    label: getDisplayName(fact),
    emailVerifiedAt: fact.emailVerifiedAt,
    verificationHistory: fact.educationHistory,
    verification: resolveSeasonEducationVerification(fact.educationHistory, affiliationRules).selectedVerification,
  }));
  const decision = evaluateRosterEducationEligibility(resolved, affiliationRules, policy
    ? { requireMemberEducation: policy.educationRequired, requireVerifiedEmail: policy.contacts.emailVerifiedRequired, requireApprovedAffiliation: true }
    : undefined);
  if (!decision.eligible || ((!policy || policy.educationRequired) && decision.selectedVerificationIds.size !== userIds.length)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, decision.blockers.join(" "));
  }
  return decision.selectedVerificationIds;
}

type ApprovedRosterMember = {
  userId: string;
  participantId: string;
  primary: boolean;
};

async function loadApprovedRosterMembers(
  tx: TxDb,
  revisionId: string,
): Promise<ApprovedRosterMember[]> {
  const rows = await tx.select({
    userId: competitionEntryRosterMembers.userId,
    participantId: competitionEntryRosterMembers.participantId,
    primary: competitionEntryRosterMembers.isPrimaryStarter,
    participantStatus: competitionEntryParticipants.status,
  }).from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
    .where(eq(competitionEntryRosterMembers.revisionId, revisionId))
    .orderBy(asc(competitionEntryRosterMembers.userId));

  if (rows.some((row) => row.participantStatus !== "confirmed")) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "已批准报名名单中存在尚未确认参赛的成员。 ");
  }
  if (new Set(rows.map((row) => row.userId)).size !== rows.length) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "已批准报名名单中存在重复成员。 ");
  }
  return rows.map(({ userId, participantId, primary }) => ({ userId, participantId, primary }));
}

function sameEventRosterMembers(
  current: ReadonlyArray<{
    userId: string;
    participantId: string | null;
    educationVerificationId: string | null;
    primary: boolean;
  }>,
  approved: readonly ApprovedRosterMember[],
  verificationIds: ReadonlyMap<string, string>,
): boolean {
  if (current.length !== approved.length) return false;
  const currentByUserId = new Map(current.map((member) => [member.userId, member]));
  return approved.every((member) => {
    const existing = currentByUserId.get(member.userId);
    return existing?.participantId === member.participantId &&
      existing.primary === member.primary &&
      existing.educationVerificationId === (verificationIds.get(member.userId) ?? null);
  });
}

type EventRosterMaterializationMember = {
  userId: string;
  participantId: string;
  primary: boolean;
  educationVerificationId: string | null | undefined;
};

/** Apply one concrete approved-roster snapshot to its EventRoster. */
export async function applyEventRosterMaterializationInTx(
  tx: TxDb,
  input: {
    eventRosterId: string;
    sourceRosterRevisionId: string;
    members: readonly EventRosterMaterializationMember[];
    status: "preparing" | "confirmed";
    actorId: string;
  },
): Promise<void> {
  const now = new Date();
  const [lockedRoster] = await tx.select({ status: eventRosters.status }).from(eventRosters)
    .where(eq(eventRosters.id, input.eventRosterId)).for("update");
  if (!lockedRoster || lockedRoster.status === "frozen") {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "正式赛事名单已冻结或不存在，不能重新物化名单。 ");
  }

  const currentMembers = await tx.select({ id: eventRosterMembers.id }).from(eventRosterMembers)
    .where(and(eq(eventRosterMembers.eventRosterId, input.eventRosterId), eq(eventRosterMembers.isCurrent, true)))
    .for("update");
  const currentMemberIds = currentMembers.map((member) => member.id);
  const referencedMembers = currentMemberIds.length > 0
    ? await tx.select({ id: matchRosterPlayers.eventRosterMemberId }).from(matchRosterPlayers)
      .where(inArray(matchRosterPlayers.eventRosterMemberId, currentMemberIds))
    : [];
  const historicalMemberIds = new Set(referencedMembers.map((member) => member.id));
  const historicalIds = currentMemberIds.filter((id) => historicalMemberIds.has(id));
  const disposableIds = currentMemberIds.filter((id) => !historicalMemberIds.has(id));
  if (historicalIds.length > 0) {
    await tx.update(eventRosterMembers).set({ isCurrent: false })
      .where(inArray(eventRosterMembers.id, historicalIds));
  }
  if (disposableIds.length > 0) {
    await tx.delete(eventRosterMembers).where(inArray(eventRosterMembers.id, disposableIds));
  }

  if (input.status === "confirmed") {
    await tx.update(eventRosters).set({
      sourceRosterRevisionId: input.sourceRosterRevisionId,
      status: "confirmed",
      confirmedAt: now,
      confirmedBy: input.actorId,
      frozenAt: null,
      frozenBy: null,
      updatedAt: now,
    }).where(eq(eventRosters.id, input.eventRosterId));
  } else {
    await tx.update(eventRosters).set({
      status: "preparing",
      confirmedAt: null,
      confirmedBy: null,
      frozenAt: null,
      frozenBy: null,
      updatedAt: now,
    }).where(eq(eventRosters.id, input.eventRosterId));
  }
  if (input.members.length > 0) {
    await tx.insert(eventRosterMembers).values(input.members.map((member) => ({
      eventRosterId: input.eventRosterId,
      userId: member.userId,
      participantId: member.participantId,
      isPrimaryStarter: member.primary,
      educationVerificationId: member.educationVerificationId ?? null,
    })));
  }
  if (input.status === "confirmed") return;
  await tx.update(eventRosters).set({
    sourceRosterRevisionId: input.sourceRosterRevisionId,
    status: "preparing",
    confirmedAt: null,
    confirmedBy: null,
    frozenAt: null,
    frozenBy: null,
    updatedAt: now,
  }).where(eq(eventRosters.id, input.eventRosterId));
}

/**
 * The caller owns the season lock. Preserve any history that may have used the
 * current snapshot; only unstarted, submitted lineups can be discarded.
 */
async function invalidateUnstartedLineupsInTx(tx: TxDb, input: {
  seasonId: string; entryId: string; actorId: string; nextRevisionId: string;
}): Promise<void> {
  const scopedMatches = await tx.select({ id: matches.id, status: matches.status, startedAt: matches.startedAt, gameplayStartedAt: matches.gameplayStartedAt })
    .from(matches).where(and(eq(matches.seasonId, input.seasonId), isNull(matches.testConfig),
      or(eq(matches.entryAId, input.entryId), eq(matches.entryBId, input.entryId))))
    .orderBy(asc(matches.id)).for("update");
  if (!scopedMatches.length) return;
  const lineups = await tx.select({ id: matchRosters.id, matchId: matchRosters.matchId, status: matchRosters.status })
    .from(matchRosters).where(and(eq(matchRosters.entryId, input.entryId), inArray(matchRosters.matchId, scopedMatches.map((match) => match.id))))
    .orderBy(asc(matchRosters.matchId)).for("update");
  const matchById = new Map(scopedMatches.map((match) => [match.id, match]));
  if (scopedMatches.some((match) => match.status === "in_progress" || match.status === "finished" || match.startedAt || match.gameplayStartedAt) ||
      lineups.some((lineup) => lineup.status !== "submitted" || matchById.get(lineup.matchId)?.status !== "scheduled")) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已有正式比赛使用或锁定此名单资格快照，不能覆盖。 ");
  }
  if (!lineups.length) return;
  await tx.delete(matchRosters).where(inArray(matchRosters.id, lineups.map((lineup) => lineup.id)));
  await writeAuditInTx(tx, { seasonId: input.seasonId, action: "competition_entry.sync_event_roster", actorId: input.actorId,
    targetId: input.entryId, meta: { sourceRosterRevisionId: input.nextRevisionId, invalidatedMatchIds: lineups.map((lineup) => lineup.matchId), reason: "approved_roster_changed", requiresLineupResubmission: true } });
}

/**
 * Copy the approved Entry roster into its Entry-owned EventRoster.
 *
 * Normal Major prestart selection and Entry re-approval both use this owner.
 * An approved Entry roster is already a confirmed captain/member commitment,
 * so the materialized EventRoster becomes confirmed in the same transaction;
 * only the later Major-wide lock turns it into a frozen roster.
 */
export async function syncApprovedRosterToEventRosterInTx(
  tx: TxDb,
  input: {
    season: typeof seasons.$inferSelect;
    coherent: PrestartEntryCoherence;
    actorId: string;
    assessment?: EntryRosterAssessment;
  },
): Promise<{ eventRosterId: string; rosterSize: number | null; changed: boolean }> {
  const { season, coherent, actorId } = input;
  const { entry, approvedRevision, eventRoster } = coherent;
  if (season.teamRegistrationConfig.qualificationPolicy?.version === 2 &&
      !(eventRoster.eligibilitySnapshot?.version === 1 && eventRoster.sourceRosterRevisionId === approvedRevision.id)) {
    if (eventRoster.eligibilitySnapshot?.version === 2 && eventRoster.sourceRosterRevisionId === approvedRevision.id &&
        (eventRoster.status === "confirmed" || eventRoster.status === "frozen")) {
      decodeFrozenLineupEligibility(eventRoster.eligibilitySnapshot, { seasonId: season.id, entryId: entry.id, rosterRevisionId: approvedRevision.id });
      await freezeQualificationRosterInTx(tx, { season, entryId: entry.id, rosterRevisionId: approvedRevision.id, eventRosterId: eventRoster.id });
      return { eventRosterId: eventRoster.id, rosterSize: null, changed: false };
    }
    const assessment = input.assessment ?? await assessEntryRosterInTx(tx, { entryId: entry.id, expectedRevisionId: approvedRevision.id });
    const adopted = await adoptApprovedRosterInTx(tx, { coherent, actorId, assessment });
    await freezeQualificationRosterInTx(tx, { season, entryId: entry.id, rosterRevisionId: approvedRevision.id, eventRosterId: adopted.eventRosterId });
    return adopted;
  }
  const freezeEligibility = () => freezeQualificationRosterInTx(tx, { season, entryId: entry.id, rosterRevisionId: approvedRevision.id, eventRosterId: eventRoster.id });
  if (eventRoster.status === "frozen") {
    if (eventRoster.sourceRosterRevisionId !== approvedRevision.id) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "最终赛事名单已冻结，不能自动改写为新的报名名单版本。 ");
    }
    await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entry.id });
    await freezeEligibility();
    return { eventRosterId: eventRoster.id, rosterSize: null, changed: false };
  }

  const approvedMembers = await loadApprovedRosterMembers(tx, approvedRevision.id);
  if (approvedMembers.length < season.minTeamSize || approvedMembers.length > season.maxTeamSize) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `最终赛事名单必须为 ${season.minTeamSize}-${season.maxTeamSize} 人。`);
  }
  const primaryCount = approvedMembers.filter((member) => member.primary).length;
  if (season.starterCount > 0 && primaryCount !== season.starterCount) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `最终赛事名单必须指定恰好 ${season.starterCount} 名主力。`);
  }
  const policy = resolveQualificationPolicy(season.teamRegistrationConfig, season.affiliationRules, "roster");
  const verificationIds = await loadApprovedRosterEducation(
    tx,
    approvedMembers.map((member) => member.userId),
    policy.affiliationRules,
    season.teamRegistrationConfig?.qualificationPolicy ? policy : undefined,
  );
  const currentMembers = await tx.select({
    userId: eventRosterMembers.userId,
    participantId: eventRosterMembers.participantId,
    educationVerificationId: eventRosterMembers.educationVerificationId,
    primary: eventRosterMembers.isPrimaryStarter,
  }).from(eventRosterMembers)
    .where(and(eq(eventRosterMembers.eventRosterId, eventRoster.id), eq(eventRosterMembers.isCurrent, true)))
    .orderBy(asc(eventRosterMembers.userId));
  const sourceUnchanged = eventRoster.sourceRosterRevisionId === approvedRevision.id;
  const membersUnchanged = sameEventRosterMembers(currentMembers, approvedMembers, verificationIds);
  if (sourceUnchanged && membersUnchanged && eventRoster.status === "confirmed") {
    await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entry.id });
    await freezeEligibility();
    return { eventRosterId: eventRoster.id, rosterSize: approvedMembers.length, changed: false };
  }

  await invalidateUnstartedLineupsInTx(tx, { seasonId: season.id, entryId: entry.id, actorId, nextRevisionId: approvedRevision.id });
  if (membersUnchanged) {
    const now = new Date();
    await tx.update(eventRosters).set({
      sourceRosterRevisionId: approvedRevision.id,
      status: "confirmed",
      confirmedAt: now,
      confirmedBy: actorId,
      frozenAt: null,
      frozenBy: null,
      updatedAt: now,
    }).where(eq(eventRosters.id, eventRoster.id));
    await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entry.id });
    await freezeEligibility();
    return { eventRosterId: eventRoster.id, rosterSize: approvedMembers.length, changed: true };
  }

  await applyEventRosterMaterializationInTx(tx, {
    eventRosterId: eventRoster.id,
    sourceRosterRevisionId: approvedRevision.id,
    members: approvedMembers.map((member) => ({
      userId: member.userId,
      participantId: member.participantId,
      primary: member.primary,
      educationVerificationId: verificationIds.get(member.userId),
    })),
    status: "confirmed",
    actorId,
  });
  await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entry.id });
  await freezeEligibility();
  return { eventRosterId: eventRoster.id, rosterSize: approvedMembers.length, changed: true };
}

/** Adopt exactly the facts assessed in this transaction for one approved revision. */
export async function adoptApprovedRosterInTx(tx: TxDb, input: {
  coherent: PrestartEntryCoherence;
  actorId: string;
  assessment: EntryRosterAssessment;
}): Promise<{ eventRosterId: string; rosterSize: number | null; changed: boolean }> {
  const { coherent, actorId, assessment } = input;
  const { candidate, rules, evidence, decisions, approvedOverrides: overrides } = assessment;
  const { entry, approvedRevision, eventRoster } = coherent;
  if (rules.source !== "policy_v2" || candidate.season.id !== entry.competitionId || candidate.entry.id !== entry.id ||
      candidate.revision.id !== approvedRevision.id || candidate.revision.entryId !== entry.id ||
      entry.registrationStatus !== "approved" || entry.currentRosterRevisionId !== approvedRevision.id || entry.approvedRosterRevisionId !== approvedRevision.id ||
      candidate.entry.currentRosterRevisionId !== approvedRevision.id || candidate.entry.approvedRosterRevisionId !== approvedRevision.id ||
      !["submitted", "waitlisted", "approved"].includes(candidate.entry.registrationStatus) || candidate.revision.status !== "approved") {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "资格评估与当前已批准名单版本不一致。");
  }
  if (decisions.length !== candidate.members.length + 1 || overrides.some((override) =>
    override.competitionId !== candidate.season.id || override.entryId !== entry.id ||
    override.rosterRevisionId !== approvedRevision.id || override.revokedAt !== null)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "名单资格评估或例外记录不完整。");
  }
  const unresolved = unresolvedQualificationFindings(decisions.flatMap((decision) => [...decision.findings]), overrides);
  if (unresolved.length) throw new AppError(ErrorCode.VALIDATION_FAILED, unresolved.map((finding) => finding.message).join(" "));
  const [locked] = await tx.select().from(eventRosters).where(and(eq(eventRosters.id, eventRoster.id), eq(eventRosters.entryId, entry.id))).for("update");
  if (!locked) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事名单不存在。");
  if (locked.eligibilitySnapshot?.version === 2 && locked.sourceRosterRevisionId === approvedRevision.id) {
    decodeEventRosterEligibilitySnapshotV2(locked.eligibilitySnapshot);
    return { eventRosterId: locked.id, rosterSize: candidate.members.length, changed: false };
  }
  if (locked.status === "frozen") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "正式赛事名单已冻结，不能覆盖资格快照。");
  await invalidateUnstartedLineupsInTx(tx, { seasonId: candidate.season.id, entryId: entry.id, actorId, nextRevisionId: approvedRevision.id });

  const selections = candidate.members.map((member) => {
    const fact = candidate.factsByUser.get(member.userId);
    if (!fact) throw new AppError(ErrorCode.VALIDATION_FAILED, "名单成员的资格事实不完整。");
    const verification = resolveSeasonEducationVerification(fact.educationHistory, rules.roster.affiliationRules).selectedVerification;
    return { member, verification };
  });
  await applyEventRosterMaterializationInTx(tx, {
    eventRosterId: locked.id, sourceRosterRevisionId: approvedRevision.id, actorId, status: "confirmed",
    members: selections.map(({ member, verification }) => ({ userId: member.userId, participantId: member.participantId, primary: member.isPrimaryStarter, educationVerificationId: verification?.id })),
  });
  const materialized = await tx.select({ id: eventRosterMembers.id, userId: eventRosterMembers.userId }).from(eventRosterMembers)
    .where(and(eq(eventRosterMembers.eventRosterId, locked.id), eq(eventRosterMembers.isCurrent, true)));
  const idsByUser = new Map(materialized.map((member) => [member.userId, member.id]));
  if (idsByUser.size !== selections.length || selections.some(({ member }) => !idsByUser.has(member.userId))) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "赛事名单物化后的成员不一致。");
  }
  const snapshot = eventRosterEligibilitySnapshotV2Schema.parse({
    version: 2, seasonId: candidate.season.id, entryId: entry.id, rosterRevisionId: approvedRevision.id,
    members: selections.map(({ member, verification }) => ({
      eventRosterMemberId: idsByUser.get(member.userId), participantId: member.participantId, userId: member.userId,
      isPrimaryStarter: member.isPrimaryStarter, educationVerificationId: verification?.id ?? null,
      education: verification ? { institutionCode: verification.institutionCode, academicStatus: verification.academicStatus, status: verification.status } : null,
      source: { rosterRevisionId: approvedRevision.id, teamMembershipId: member.teamMembershipId },
    })),
    rules: { qualificationPolicy: { version: 2, educationRequired: rules.participant.educationRequired, contacts: rules.participant.contacts,
      competitiveProfileRequired: rules.participant.competitiveProfileRequired, ...rules.competitive },
      affiliationRules: rules.roster.affiliationRules, allowedPlayerTypes: rules.participant.allowedPlayerTypes ?? [], rankThreshold: rules.participant.rankThreshold ?? { currentMin: null, peakMin: null }, starterCount: rules.lineup.starterCount, maxSubstitutes: rules.lineup.settings?.maxSubstitutes },
    competitive: evidence.kind === "competitive" ? { profile: evidence.context.profile, requirements: evidence.requirements,
      byPurpose: { profileReadiness: [...evidence.byPurpose.profileReadiness].map(([userId, fact]) => ({ userId, historicalPeak: fact.historicalPeak, seasons: Object.fromEntries(fact.seasons) })),
        rankThreshold: [...evidence.byPurpose.rankThreshold].map(([userId, fact]) => ({ userId, ...fact })),
        externalStrength: [...evidence.byPurpose.externalStrength].map(([userId, fact]) => ({ userId, ...fact })) } } : null,
    overrides: overrides.map((override) => ({ restrictionCode: override.restrictionCode, findingSnapshot: override.findingSnapshot,
      reason: override.reason, grantedBy: override.grantedBy, grantedAt: override.grantedAt.toISOString() })),
  });
  await tx.update(eventRosters).set({ eligibilitySnapshot: snapshot }).where(eq(eventRosters.id, locked.id));
  return { eventRosterId: locked.id, rosterSize: candidate.members.length, changed: true };
}
