import { and, asc, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  competitionEntryParticipants,
  competitionEntryRosterMembers,
  eventRosterMembers,
  eventRosters,
  majorTournamentEntrants,
  seasons,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { evaluateRosterEducationEligibility, resolveSeasonEducationVerification } from "@/lib/education/eligibility";
import { assertSinglePrestartEntryCoherenceInTx, type PrestartEntryCoherence } from "@/lib/major/prestart-entry";
import { assertMajorPrestartEntrantsMutable, ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";
import { loadParticipantQualificationFacts } from "@/lib/qualification/service";
import { normalizeAffiliationRules } from "@/types/season";

export interface SaveMajorPrestartRosterInput {
  seasonId: string;
  entrantId: string;
  userIds: readonly string[];
  reason: string;
  actorId: string;
}

async function loadApprovedRosterEducation(
  tx: TxDb,
  userIds: readonly string[],
  affiliationRules: Parameters<typeof evaluateRosterEducationEligibility>[1],
): Promise<Map<string, string>> {
  const facts = await loadParticipantQualificationFacts(userIds, { executor: tx, includeCompetitiveFacts: false });
  const resolved = [...facts.entries()].map(([userId, fact]) => ({
    userId,
    email: fact.email ?? "",
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
async function applyEventRosterMaterializationInTx(
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
  await tx.delete(eventRosterMembers).where(eq(eventRosterMembers.eventRosterId, input.eventRosterId));
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
    .where(eq(eventRosterMembers.eventRosterId, eventRoster.id))
    .orderBy(asc(eventRosterMembers.userId));
  const sourceUnchanged = eventRoster.sourceRosterRevisionId === approvedRevision.id;
  const membersUnchanged = sameEventRosterMembers(currentMembers, approvedMembers, verificationIds);
  if (sourceUnchanged && membersUnchanged && eventRoster.status === "confirmed") {
    await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entry.id });
    return { eventRosterId: eventRoster.id, rosterSize: approvedMembers.length, changed: false };
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

/**
 * Reconcile a selected Major entrant after its Entry receives a new approved
 * roster revision. The entrant row is intentionally checked after
 * Entry → EventRoster locking, matching the prestart lock order.
 */
export async function reconcileMajorPrestartRosterAfterApprovalInTx(
  tx: TxDb,
  input: { seasonId: string; entryId: string; actorId: string },
): Promise<boolean> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId));
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  if (season.competitionTemplate !== "major") return false;

  const [entrantRef] = await tx.select({
    id: majorTournamentEntrants.id,
    seasonId: majorTournamentEntrants.seasonId,
    competitionEntryId: majorTournamentEntrants.competitionEntryId,
  }).from(majorTournamentEntrants).where(and(
    eq(majorTournamentEntrants.seasonId, season.id),
    eq(majorTournamentEntrants.competitionEntryId, input.entryId),
  ));
  if (!entrantRef) return false;

  const coherent = await assertSinglePrestartEntryCoherenceInTx(
    tx,
    season.id,
    { competitionEntryId: entrantRef.competitionEntryId },
    { requireEventRosterSync: false },
  );
  const [entrant] = await tx.select().from(majorTournamentEntrants)
    .where(and(eq(majorTournamentEntrants.id, entrantRef.id), eq(majorTournamentEntrants.seasonId, season.id)))
    .for("update");
  if (!entrant || entrant.competitionEntryId !== entrantRef.competitionEntryId) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队引用在名单自动同步期间发生变化，拒绝继续。 ");
  }

  const result = await syncApprovedRosterToEventRosterInTx(tx, {
    season,
    coherent,
    actorId: input.actorId,
  });
  if (result.changed) {
    await tx.insert(auditLogs).values({
      seasonId: season.id,
      action: "major_prestart.reconcile_roster",
      actorId: input.actorId,
      targetId: entrant.id,
      targetType: "major_tournament_entrant",
      meta: {
        sourceRosterRevisionId: coherent.approvedRevision.id,
        rosterSize: result.rosterSize,
        eventRosterId: result.eventRosterId,
      },
    });
  }
  return result.changed;
}

/**
 * Canonical transaction owner for saving a Major prestart event roster.
 *
 * The resync path intentionally starts with a relaxed source-revision check:
 * it locks Entry → eventRoster before reading the approved revision it is
 * about to copy. The entrant is then locked and compared with the original
 * ref before any members are rewritten. The final strict coherence check
 * proves that the resync restored the normal invariant.
 */
export async function saveMajorPrestartRosterInTx(
  tx: TxDb,
  input: SaveMajorPrestartRosterInput,
): Promise<{ seasonSlug: string }> {
  const reason = input.reason.trim();
  if (!reason) throw new AppError(ErrorCode.VALIDATION_FAILED, "名单补正必须填写原因。");
  const [season] = await tx.select().from(seasons)
    .where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  if (input.userIds.length < season.minTeamSize || input.userIds.length > season.maxTeamSize) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `最终名单必须为 ${season.minTeamSize}-${season.maxTeamSize} 人。`);
  }
  if (new Set(input.userIds).size !== input.userIds.length) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "最终名单中不能重复同一位选手。");
  }

  const state = await ensureMajorPrestartStateInTx(tx, season.id);
  assertMajorPrestartEntrantsMutable(state);

  const [entrantRef] = await tx.select({
    id: majorTournamentEntrants.id,
    seasonId: majorTournamentEntrants.seasonId,
    competitionEntryId: majorTournamentEntrants.competitionEntryId,
  }).from(majorTournamentEntrants)
    .where(and(eq(majorTournamentEntrants.id, input.entrantId), eq(majorTournamentEntrants.seasonId, season.id)));
  if (!entrantRef) throw new AppError(ErrorCode.NOT_FOUND, "正式参赛队不存在。");

  const coherent = await assertSinglePrestartEntryCoherenceInTx(
    tx,
    season.id,
    { competitionEntryId: entrantRef.competitionEntryId },
    { requireEventRosterSync: false },
  );
  const [entrant] = await tx.select().from(majorTournamentEntrants)
    .where(and(eq(majorTournamentEntrants.id, entrantRef.id), eq(majorTournamentEntrants.seasonId, season.id))).for("update");
  if (!entrant || entrant.seasonId !== entrantRef.seasonId || entrant.competitionEntryId !== entrantRef.competitionEntryId) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "赛前参赛队引用在名单同步期间发生变化，拒绝继续保存。");
  }

  const eventRoster = coherent.eventRoster;
  if (eventRoster.status === "frozen") {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "最终赛事名单已冻结，不能直接修改。");
  }
  if (eventRoster.status === "confirmed") {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先显式重新开放这支队伍的最终赛事名单。");
  }

  const formalMembers = await tx.select({
    userId: competitionEntryRosterMembers.userId,
    participantId: competitionEntryRosterMembers.participantId,
    primary: competitionEntryRosterMembers.isPrimaryStarter,
  }).from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
    .where(and(
      eq(competitionEntryRosterMembers.revisionId, coherent.approvedRevision.id),
      eq(competitionEntryParticipants.status, "confirmed"),
      inArray(competitionEntryRosterMembers.userId, input.userIds),
    ));
  if (formalMembers.length !== input.userIds.length) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "最终名单只能选择该正式队伍当前的成员。 ");
  }
  const verificationIds = await loadApprovedRosterEducation(tx, input.userIds, normalizeAffiliationRules(season.affiliationRules));

  await applyEventRosterMaterializationInTx(tx, {
    eventRosterId: eventRoster.id,
    sourceRosterRevisionId: coherent.approvedRevision.id,
    members: formalMembers.map((member) => ({
      userId: member.userId,
      participantId: member.participantId,
      primary: member.primary,
      educationVerificationId: verificationIds.get(member.userId),
    })),
    status: "preparing",
    actorId: input.actorId,
  });

  await assertSinglePrestartEntryCoherenceInTx(tx, season.id, {
    competitionEntryId: entrant.competitionEntryId,
  });
  await tx.insert(auditLogs).values({
    seasonId: season.id,
    action: "major_prestart.repair_roster",
    actorId: input.actorId,
    targetId: entrant.id,
    targetType: "major_prestart_entrant",
    meta: { rosterSize: input.userIds.length, sourceRosterRevisionId: coherent.approvedRevision.id, reason },
  });
  return { seasonSlug: season.slug };
}
