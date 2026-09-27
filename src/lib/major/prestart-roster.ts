import { and, eq, inArray } from "drizzle-orm";
import { writeAuditInTx } from "@/lib/audit/write";

import type { TxDb } from "@/db/client";
import {
  competitionEntryParticipants,
  competitionEntryRosterMembers,
  majorTournamentEntrants,
  seasons,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertSinglePrestartEntryCoherenceInTx } from "@/lib/event-rosters/coherence";
import { assertMajorPrestartEntrantsMutable, ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";
import { normalizeAffiliationRules } from "@/lib/seasons/compatibility";

export interface SaveMajorPrestartRosterInput {
  seasonId: string;
  entrantId: string;
  userIds: readonly string[];
  reason: string;
  actorId: string;
}

import {
  applyEventRosterMaterializationInTx,
  loadApprovedRosterEducation,
  syncApprovedRosterToEventRosterInTx,
} from "@/lib/event-rosters/owner";

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
    await writeAuditInTx(tx, {
      seasonId: season.id,
      action: "major_prestart.reconcile_roster",
      actorId: input.actorId,
      targetId: entrant.id,meta: {
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
  await writeAuditInTx(tx, {
    seasonId: season.id,
    action: "major_prestart.repair_roster",
    actorId: input.actorId,
    targetId: entrant.id,meta: { rosterSize: input.userIds.length, sourceRosterRevisionId: coherent.approvedRevision.id, reason },
  });
  return { seasonSlug: season.slug };
}
