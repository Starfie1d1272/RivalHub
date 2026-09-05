import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  competitionEntries,
  competitionEntryRosterMembers,
  eventRosterMembers,
  eventRosters,
  majorPrestartIssues,
  majorPrestartStates,
  majorTournamentEntrants,
  majorTournamentSeeds,
  seasons,
} from "@/db/schema";
import { validateApprovedCompetitionEntryRosterInTx } from "@/lib/competition-entries/commands";
import { getStandardMajorDefinition, type StandardMajorDefinition } from "@/lib/major/standard";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertPrestartEntryCoherenceInTx, type PrestartEntryCoherence } from "@/lib/major/prestart-entry";
import { syncApprovedRosterToEventRosterInTx } from "@/lib/major/prestart-roster";
import { assertMajorPrestartEntrantsMutable, ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";

function assertStandardMajorSeason(season: typeof seasons.$inferSelect): StandardMajorDefinition {
  return getStandardMajorDefinition(season, {
    notMajor: "当前赛事不是 Major 赛事模板，不能管理赛前正式参赛队。 ",
    notStandard: "当前赛事不是标准 Major，不能管理赛前正式参赛队。 ",
  });
}

export interface SelectMajorEntrantsResult {
  seasonSlug: string;
  selectedCount: number;
  synchronizedRosterCount: number;
  changed: boolean;
}

export async function selectMajorEntrantsAndSyncRostersInTx(
  tx: TxDb,
  input: { seasonId: string; competitionEntryIds: readonly string[]; actorId: string },
): Promise<SelectMajorEntrantsResult> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const { entrantCapacity } = assertStandardMajorSeason(season);
  const state = await ensureMajorPrestartStateInTx(tx, season.id);
  assertMajorPrestartEntrantsMutable(state);

  const selectedEntryIds = [...input.competitionEntryIds];
  if (selectedEntryIds.length > entrantCapacity) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `Major 最多只能选择 ${entrantCapacity} 支正式参赛队。 `);
  }
  if (new Set(selectedEntryIds).size !== selectedEntryIds.length) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "正式参赛队不能重复选择。 ");
  }

  // The season lock serializes review, roster-change, and prestart mutations;
  // locking all currently approved Entries makes the capacity decision and
  // the selected set one consistent fact.
  const approvedEntries = await tx.select().from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.registrationStatus, "approved")))
    .orderBy(asc(competitionEntries.id))
    .for("update");
  if (approvedEntries.length > entrantCapacity && selectedEntryIds.length !== entrantCapacity) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `当前有 ${approvedEntries.length} 支已批准队伍，最终正式参赛队必须恰好选择 ${entrantCapacity} 支。 `);
  }
  const approvedById = new Map(approvedEntries.map((entry) => [entry.id, entry]));
  for (const entryId of selectedEntryIds) {
    if (!approvedById.has(entryId)) {
      throw new AppError(ErrorCode.NOT_FOUND, "只能选择当前赛事中已批准的 CompetitionEntry。 ");
    }
  }

  const existingRefs = await tx.select({
    id: majorTournamentEntrants.id,
    competitionEntryId: majorTournamentEntrants.competitionEntryId,
  }).from(majorTournamentEntrants)
    .where(eq(majorTournamentEntrants.seasonId, season.id))
    .orderBy(asc(majorTournamentEntrants.id));
  const existingByEntryId = new Map(existingRefs.map((entrant) => [entrant.competitionEntryId, entrant]));
  const existingEntryIds = existingRefs.map((entrant) => entrant.competitionEntryId);
  const entryIdsToLock = [...new Set([...selectedEntryIds, ...existingEntryIds])].sort();
  const lockedEntries = entryIdsToLock.length === 0 ? [] : await tx.select().from(competitionEntries)
    .where(inArray(competitionEntries.id, entryIdsToLock))
    .orderBy(asc(competitionEntries.id))
    .for("update");
  const lockedEntryById = new Map(lockedEntries.map((entry) => [entry.id, entry]));
  if (lockedEntries.length !== entryIdsToLock.length) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队引用了不存在的 CompetitionEntry。 ");
  }

  const selectedEntries = selectedEntryIds.map((entryId) => {
    const entry = lockedEntryById.get(entryId);
    if (!entry || entry.registrationStatus !== "approved" || !entry.approvedRosterRevisionId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "已选择的 CompetitionEntry 缺少可用的 approved roster revision。 ");
    }
    return entry;
  });
  if (selectedEntries.length > 0) {
    const existingRosters = await tx.select({ entryId: eventRosters.entryId })
      .from(eventRosters)
      .where(inArray(eventRosters.entryId, selectedEntryIds))
      .for("update");
    const rosterEntryIds = new Set(existingRosters.map((roster) => roster.entryId));
    const missingRosters = selectedEntries.filter((entry) => !rosterEntryIds.has(entry.id));
    if (missingRosters.length > 0) {
      await tx.insert(eventRosters).values(missingRosters.map((entry) => ({
        entryId: entry.id,
        sourceRosterRevisionId: entry.approvedRosterRevisionId!,
        status: "preparing" as const,
      }))).onConflictDoNothing({ target: eventRosters.entryId });
    }
  }

  const coherent: PrestartEntryCoherence[] = selectedEntryIds.length === 0
    ? []
    : await assertPrestartEntryCoherenceInTx(
      tx,
      season.id,
      selectedEntryIds.map((competitionEntryId) => ({ competitionEntryId })),
      { requireEventRosterSync: false },
    );
  for (const row of coherent) {
    await validateApprovedCompetitionEntryRosterInTx(tx, row.entry, season);
  }

  const revisionIds = coherent.map((row) => row.approvedRevision.id);
  if (revisionIds.length > 0) {
    const memberRows = await tx.select({
      revisionId: competitionEntryRosterMembers.revisionId,
      userId: competitionEntryRosterMembers.userId,
    }).from(competitionEntryRosterMembers).where(inArray(competitionEntryRosterMembers.revisionId, revisionIds));
    const seenUserIds = new Set<string>();
    for (const member of memberRows) {
      if (seenUserIds.has(member.userId)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "最终正式参赛队的已批准报名名单存在重复选手。 ");
      }
      seenUserIds.add(member.userId);
    }
  }

  const existingEntrants = existingRefs.length === 0 ? [] : await tx.select().from(majorTournamentEntrants)
    .where(inArray(majorTournamentEntrants.id, existingRefs.map((entrant) => entrant.id)))
    .orderBy(asc(majorTournamentEntrants.id))
    .for("update");
  if (existingEntrants.length !== existingRefs.length) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队集合在选择期间发生变化，拒绝继续。 ");
  }
  const selectedSet = new Set(selectedEntryIds);
  const removedEntrants = existingEntrants.filter((entrant) => !selectedSet.has(entrant.competitionEntryId));
  if (removedEntrants.length > 0) {
    const seeded = await tx.select({ id: majorTournamentSeeds.id }).from(majorTournamentSeeds)
      .where(inArray(majorTournamentSeeds.tournamentEntrantId, removedEntrants.map((entrant) => entrant.id)));
    if (seeded.length > 0) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已有种子的正式参赛队不能在种子处理后被静默移出。 ");
    }
    const frozenRosters = await tx.select({ id: eventRosters.id }).from(eventRosters)
      .where(and(
        inArray(eventRosters.entryId, removedEntrants.map((entrant) => entrant.competitionEntryId)),
        eq(eventRosters.status, "frozen"),
      ));
    if (frozenRosters.length > 0) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已有冻结赛事名单的正式参赛队不能被静默移出最终集合。 ");
    }
  }

  const missingEntrants = selectedEntries.filter((entry) => !existingByEntryId.has(entry.id));
  if (missingEntrants.length > 0) {
    await tx.insert(majorTournamentEntrants).values(missingEntrants.map((entry) => ({
      seasonId: season.id,
      competitionEntryId: entry.id,
    }))).onConflictDoNothing({ target: [majorTournamentEntrants.seasonId, majorTournamentEntrants.competitionEntryId] });
  }
  const selectedEntrants = selectedEntryIds.length === 0 ? [] : await tx.select().from(majorTournamentEntrants)
    .where(and(eq(majorTournamentEntrants.seasonId, season.id), inArray(majorTournamentEntrants.competitionEntryId, selectedEntryIds)))
    .orderBy(asc(majorTournamentEntrants.competitionEntryId))
    .for("update");
  if (selectedEntrants.length !== selectedEntryIds.length) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队 materialize 失败，拒绝继续。 ");
  }
  const entrantByEntryId = new Map(selectedEntrants.map((entrant) => [entrant.competitionEntryId, entrant]));

  let synchronizedRosterCount = 0;
  for (const row of coherent) {
    const entrant = entrantByEntryId.get(row.entry.id);
    if (!entrant) throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队与 CompetitionEntry 映射丢失。 ");
    const result = await syncApprovedRosterToEventRosterInTx(tx, {
      season,
      coherent: row,
      actorId: input.actorId,
    });
    if (result.changed) synchronizedRosterCount += 1;
  }

  if (removedEntrants.length > 0) {
    await tx.delete(majorTournamentEntrants)
      .where(inArray(majorTournamentEntrants.id, removedEntrants.map((entrant) => entrant.id)));
  }

  const selectionChanged = existingRefs.length !== selectedEntryIds.length ||
    existingRefs.some((entrant) => !selectedSet.has(entrant.competitionEntryId));
  const changed = selectionChanged || synchronizedRosterCount > 0;
  if (changed) {
    await tx.insert(auditLogs).values({
      seasonId: season.id,
      action: "major_prestart.select_entrants",
      actorId: input.actorId,
      targetId: state.id,
      targetType: "major_prestart_state",
      meta: {
        entrantCount: selectedEntryIds.length,
        synchronizedRosterCount,
        selectionChanged,
      },
    });
  }
  return {
    seasonSlug: season.slug,
    selectedCount: selectedEntryIds.length,
    synchronizedRosterCount,
    changed,
  };
}

export interface LockMajorEntrantsResult {
  seasonSlug: string;
  entrantCount: number;
  alreadyLocked: boolean;
}

export async function lockMajorPrestartEntrantsInTx(
  tx: TxDb,
  input: { seasonId: string; actorId: string },
): Promise<LockMajorEntrantsResult> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const { entrantCapacity } = assertStandardMajorSeason(season);
  const state = await ensureMajorPrestartStateInTx(tx, season.id);
  if (state.entrantsLockedAt) return { seasonSlug: season.slug, entrantCount: entrantCapacity, alreadyLocked: true };

  const entrantRefs = await tx.select({
    id: majorTournamentEntrants.id,
    seasonId: majorTournamentEntrants.seasonId,
    competitionEntryId: majorTournamentEntrants.competitionEntryId,
  }).from(majorTournamentEntrants)
    .where(eq(majorTournamentEntrants.seasonId, season.id))
    .orderBy(asc(majorTournamentEntrants.id));
  const coherent = await assertPrestartEntryCoherenceInTx(
    tx,
    season.id,
    entrantRefs.map((entrant) => ({ competitionEntryId: entrant.competitionEntryId })),
  );
  if (entrantRefs.length !== entrantCapacity) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `锁定前必须恰好选择 ${entrantCapacity} 支正式参赛队。 `);
  }
  if (coherent.some((row) => row.eventRoster.status !== "confirmed")) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "所有正式参赛队必须先由已批准报名名单同步并确认。 ");
  }

  const entrantRows = await tx.select().from(majorTournamentEntrants)
    .where(inArray(majorTournamentEntrants.id, entrantRefs.map((entrant) => entrant.id)))
    .orderBy(asc(majorTournamentEntrants.id))
    .for("update");
  const refById = new Map(entrantRefs.map((entrant) => [entrant.id, entrant]));
  if (entrantRows.length !== entrantRefs.length || entrantRows.some((entrant) => {
    const ref = refById.get(entrant.id);
    return !ref || ref.seasonId !== entrant.seasonId || ref.competitionEntryId !== entrant.competitionEntryId;
  })) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队集合在锁定期间发生变化，拒绝继续。 ");
  }

  const rosterRows = await tx.select({
    entrantId: majorTournamentEntrants.id,
    userId: eventRosterMembers.userId,
    educationVerificationId: eventRosterMembers.educationVerificationId,
    primary: eventRosterMembers.isPrimaryStarter,
  }).from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.competitionEntryId, eventRosters.entryId))
    .where(eq(majorTournamentEntrants.seasonId, season.id));
  const rosterByEntrant = new Map<string, typeof rosterRows>();
  for (const row of rosterRows) rosterByEntrant.set(row.entrantId, [...(rosterByEntrant.get(row.entrantId) ?? []), row]);
  const seenUsers = new Set<string>();
  for (const entrant of entrantRows) {
    const roster = rosterByEntrant.get(entrant.id) ?? [];
    if (roster.length < season.minTeamSize || roster.length > season.maxTeamSize) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "存在不符合人数规则的最终赛事名单。 ");
    }
    if (season.starterCount > 0 && roster.filter((member) => member.primary).length !== season.starterCount) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `每支正式参赛队必须有恰好 ${season.starterCount} 名主力。 `);
    }
    if (roster.some((member) => !member.educationVerificationId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "最终赛事名单缺少已批准报名名单对应的教育认证依据。 ");
    }
    for (const member of roster) {
      if (seenUsers.has(member.userId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "最终赛事名单存在重复选手。 ");
      seenUsers.add(member.userId);
    }
  }

  const [unresolved] = await tx.select({ id: majorPrestartIssues.id }).from(majorPrestartIssues)
    .where(and(eq(majorPrestartIssues.seasonId, season.id), isNull(majorPrestartIssues.resolvedAt)))
    .limit(1);
  if (unresolved) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先处理所有资格和管理事项。 ");

  const now = new Date();
  await tx.update(eventRosters).set({
    status: "frozen",
    confirmedAt: now,
    confirmedBy: input.actorId,
    frozenAt: now,
    frozenBy: input.actorId,
    updatedAt: now,
  }).where(inArray(eventRosters.id, coherent.map((row) => row.eventRoster.id)));
  await tx.update(majorPrestartStates).set({
    entrantsLockedAt: now,
    entrantsLockedBy: input.actorId,
    updatedAt: now,
  }).where(eq(majorPrestartStates.id, state.id));
  await tx.insert(auditLogs).values({
    seasonId: season.id,
    action: "major_prestart.lock_entrants",
    actorId: input.actorId,
    targetId: state.id,
    targetType: "major_prestart_state",
    meta: { entrantCount: entrantRows.length },
  });
  return { seasonSlug: season.slug, entrantCount: entrantRows.length, alreadyLocked: false };
}
