import { and, eq, inArray } from "drizzle-orm";
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
import { assertSinglePrestartEntryCoherenceInTx } from "@/lib/major/prestart-entry";
import { assertMajorPrestartEntrantsMutable, ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";
import { loadEducationMembershipFacts } from "@/lib/qualification/service";
import { normalizeAffiliationRules } from "@/types/season";

export interface SaveMajorPrestartRosterInput {
  seasonId: string;
  entrantId: string;
  userIds: readonly string[];
  actorId: string;
}

export async function loadApprovedRosterEducation(
  tx: TxDb,
  userIds: readonly string[],
  affiliationRules: Parameters<typeof evaluateRosterEducationEligibility>[1],
): Promise<Map<string, string>> {
  const facts = await loadEducationMembershipFacts(tx, userIds);
  const resolved = [...facts.entries()].map(([userId, { email, emailVerifiedAt, history }]) => ({
    userId,
    email,
    emailVerifiedAt,
    verificationHistory: history,
    verification: resolveSeasonEducationVerification(history, affiliationRules).selectedVerification,
  }));
  const decision = evaluateRosterEducationEligibility(resolved, affiliationRules);
  if (!decision.eligible || decision.selectedVerificationIds.size !== userIds.length) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, decision.blockers.join(" "));
  }
  return decision.selectedVerificationIds;
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

  await tx.delete(eventRosterMembers).where(eq(eventRosterMembers.eventRosterId, eventRoster.id));
  await tx.insert(eventRosterMembers).values(formalMembers.map((member) => ({
    eventRosterId: eventRoster.id,
    userId: member.userId,
    participantId: member.participantId,
    isPrimaryStarter: member.primary,
    educationVerificationId: verificationIds.get(member.userId),
  })));
  await tx.update(eventRosters).set({
    status: "preparing",
    sourceRosterRevisionId: coherent.approvedRevision.id,
    confirmedAt: null,
    confirmedBy: null,
    frozenAt: null,
    frozenBy: null,
    updatedAt: new Date(),
  }).where(eq(eventRosters.id, eventRoster.id));

  await assertSinglePrestartEntryCoherenceInTx(tx, season.id, {
    competitionEntryId: entrant.competitionEntryId,
  });
  await tx.insert(auditLogs).values({
    seasonId: season.id,
    action: "major_prestart.save_roster",
    actorId: input.actorId,
    targetId: entrant.id,
    targetType: "major_prestart_entrant",
    meta: { rosterSize: input.userIds.length, sourceRosterRevisionId: coherent.approvedRevision.id },
  });
  return { seasonSlug: season.slug };
}
