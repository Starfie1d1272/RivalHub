import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  competitionEntryParticipants,
  competitionEntryRosterMembers,
  eventRosterMembers,
  eventRosters,
  matchRosterPlayers,
  seasons,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { evaluateRosterEducationEligibility, resolveSeasonEducationVerification } from "@/lib/education/eligibility";
import { getDisplayName } from "@/lib/identity/display-name";
import { assertSinglePrestartEntryCoherenceInTx, type PrestartEntryCoherence } from "@/lib/event-rosters/coherence";
import { loadParticipantQualificationFacts } from "@/lib/qualification/service";
import { normalizeAffiliationRules } from "@/lib/seasons/compatibility";

export async function loadApprovedRosterEducation(
  tx: TxDb,
  userIds: readonly string[],
  affiliationRules: Parameters<typeof evaluateRosterEducationEligibility>[1],
): Promise<Map<string, string>> {
  const facts = await loadParticipantQualificationFacts(userIds, { executor: tx, includeCompetitiveFacts: false });
  const resolved = [...facts.entries()].map(([userId, fact]) => ({
    userId,
    label: getDisplayName(fact),
    emailVerifiedAt: fact.emailVerifiedAt,
    verificationHistory: fact.educationHistory,
    verification: resolveSeasonEducationVerification(fact.educationHistory, affiliationRules).selectedVerification,
  }));
  const decision = evaluateRosterEducationEligibility(resolved, affiliationRules);
  if (!decision.eligible || decision.selectedVerificationIds.size !== userIds.length) {
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
  },
): Promise<{ eventRosterId: string; rosterSize: number | null; changed: boolean }> {
  const { season, coherent, actorId } = input;
  const { entry, approvedRevision, eventRoster } = coherent;
  if (eventRoster.status === "frozen") {
    if (eventRoster.sourceRosterRevisionId !== approvedRevision.id) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "最终赛事名单已冻结，不能自动改写为新的报名名单版本。 ");
    }
    await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entry.id });
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
  const verificationIds = await loadApprovedRosterEducation(
    tx,
    approvedMembers.map((member) => member.userId),
    normalizeAffiliationRules(season.affiliationRules),
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
    return { eventRosterId: eventRoster.id, rosterSize: approvedMembers.length, changed: false };
  }

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
  return { eventRosterId: eventRoster.id, rosterSize: approvedMembers.length, changed: true };
}
