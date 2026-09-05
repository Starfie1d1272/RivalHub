import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  eventRosterMembers,
  eventRosters,
  majorPrestartStates,
  majorSeedRecommendationSnapshots,
  majorTournamentEntrants,
  majorTournamentSeeds,
  seasons,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertPrestartEntryCoherenceInTx } from "@/lib/major/prestart-entry";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";
import { analyzeFinalSeedOrder } from "@/lib/major/team-seed-recommendation";
import {
  buildFrozenSetFingerprint,
  frozenTeamsForSnapshot,
  getSeedRecommendationSnapshotStatus,
} from "@/lib/major/seed-recommendation-snapshot";

export interface SaveMajorTournamentSeedsInTxInput {
  seasonId: string;
  entryIds: readonly string[];
  overrideReason: string | null;
  actorId: string;
}

async function loadCurrentFrozenSeedSetInTx(tx: TxDb, seasonId: string): Promise<{
  entrants: Array<{ id: string; entryId: string }>;
  frozenSetFingerprint: string;
}> {
  const entrantRefs = await tx.select({
    id: majorTournamentEntrants.id,
    entryId: majorTournamentEntrants.competitionEntryId,
  }).from(majorTournamentEntrants)
    .where(eq(majorTournamentEntrants.seasonId, seasonId))
    .orderBy(asc(majorTournamentEntrants.id));
  const coherent = await assertPrestartEntryCoherenceInTx(
    tx,
    seasonId,
    entrantRefs.map((entrant) => ({ competitionEntryId: entrant.entryId })),
  );
  if (coherent.some((row) => row.eventRoster.status !== "frozen")) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "正式参赛队和 EventRoster 尚未完成统一冻结，不能继续处理最终种子。 ");
  }

  const entrants = await tx.select({
    id: majorTournamentEntrants.id,
    entryId: majorTournamentEntrants.competitionEntryId,
  }).from(majorTournamentEntrants)
    .where(eq(majorTournamentEntrants.seasonId, seasonId))
    .orderBy(asc(majorTournamentEntrants.id))
    .for("update");
  if (entrants.length !== entrantRefs.length || entrants.some((entrant, index) => {
    const reference = entrantRefs[index];
    return !reference || reference.id !== entrant.id || reference.entryId !== entrant.entryId;
  })) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队集合在最终种子校验期间发生变化，拒绝继续。 ");
  }

  const coherenceByEntryId = new Map(coherent.map((row) => [row.entry.id, row]));
  const eventRosterIds = coherent.map((row) => row.eventRoster.id);
  const rosterRows = eventRosterIds.length === 0 ? [] : await tx.select({
    entrantId: majorTournamentEntrants.id,
    userId: eventRosterMembers.userId,
    participantId: eventRosterMembers.participantId,
    educationVerificationId: eventRosterMembers.educationVerificationId,
    isPrimaryStarter: eventRosterMembers.isPrimaryStarter,
  }).from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .innerJoin(majorTournamentEntrants, eq(eventRosters.entryId, majorTournamentEntrants.competitionEntryId))
    .where(and(
      inArray(eventRosterMembers.eventRosterId, eventRosterIds),
      eq(eventRosters.status, "frozen"),
    ))
    .orderBy(asc(eventRosterMembers.userId))
    .for("update");
  const frozenTeams = frozenTeamsForSnapshot(
    entrants.map((entrant) => {
      const row = coherenceByEntryId.get(entrant.entryId);
      if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队缺少一致性校验结果。 ");
      return {
        id: entrant.id,
        teamId: entrant.entryId,
        eventRosterId: row.eventRoster.id,
        sourceRosterRevisionId: row.eventRoster.sourceRosterRevisionId,
        teamName: row.entry.name,
      };
    }),
    rosterRows,
  );
  return {
    entrants,
    frozenSetFingerprint: buildFrozenSetFingerprint(seasonId, frozenTeams),
  };
}

async function loadReadySnapshotInTx(
  tx: TxDb,
  seasonId: string,
  frozenSetFingerprint: string,
): Promise<typeof majorSeedRecommendationSnapshots.$inferSelect> {
  const [snapshot] = await tx.select().from(majorSeedRecommendationSnapshots)
    .where(eq(majorSeedRecommendationSnapshots.seasonId, seasonId))
    .for("update");
  const status = getSeedRecommendationSnapshotStatus({ snapshot, seasonId, frozenSetFingerprint });
  if (status !== "ready") {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      status === "missing"
        ? "系统种子建议快照尚未生成，不能处理最终种子。 "
        : "系统种子建议快照与当前冻结的参赛队或 EventRoster 不一致，拒绝处理最终种子。 ",
    );
  }
  return snapshot!;
}

export async function saveMajorTournamentSeedsInTx(
  tx: TxDb,
  input: SaveMajorTournamentSeedsInTxInput,
): Promise<void> {
  const [season] = await tx.select().from(seasons)
    .where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const { entrantCapacity } = getStandardMajorDefinition(season);
  const state = await ensureMajorPrestartStateInTx(tx, season.id);
  if (state.seedsLockedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事已经正式开赛，不能修改赛事种子。 ");
  if (!state.entrantsLockedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先锁定正式参赛队和最终赛事名单。 ");

  const frozenSet = await loadCurrentFrozenSeedSetInTx(tx, season.id);
  const entrants = frozenSet.entrants;
  const entrantsByEntryId = new Map(entrants.map((entrant) => [entrant.entryId, entrant]));
  if (
    new Set(input.entryIds).size !== input.entryIds.length ||
    input.entryIds.length !== entrantCapacity ||
    entrantsByEntryId.size !== entrantCapacity ||
    input.entryIds.some((entryId) => !entrantsByEntryId.has(entryId))
  ) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `赛事种子必须且只能覆盖已锁定的 ${entrantCapacity} 支正式参赛队。 `);
  }

  const snapshot = await loadReadySnapshotInTx(tx, season.id, frozenSet.frozenSetFingerprint);

  const overrideReason = input.overrideReason?.trim() || null;
  if (overrideReason && overrideReason.length > 500) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "人工调整原因不能超过 500 个字符。 ");
  }
  const decision = analyzeFinalSeedOrder(input.entryIds, snapshot.recommendations);
  if (decision.divergesFromRecommendation && !overrideReason) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "最终种子偏离系统建议时，必须填写人工调整原因。 ");
  }
  const persistedOverrideReason = decision.divergesFromRecommendation || decision.resolvesSystemTie
    ? overrideReason
    : null;

  await tx.delete(majorTournamentSeeds).where(eq(majorTournamentSeeds.seasonId, season.id));
  await tx.insert(majorTournamentSeeds).values(input.entryIds.map((entryId, index) => ({
    seasonId: season.id,
    tournamentEntrantId: entrantsByEntryId.get(entryId)!.id,
    seed: index + 1,
  })));
  await tx.update(majorPrestartStates).set({
    seedsConfirmedAt: null,
    seedsConfirmedBy: null,
    seedOverrideReason: persistedOverrideReason,
    updatedAt: new Date(),
  }).where(eq(majorPrestartStates.id, state.id));
  await tx.insert(auditLogs).values({
    seasonId: season.id,
    action: "major_prestart.save_tournament_seeds",
    actorId: input.actorId,
    targetId: state.id,
    targetType: "major_prestart_state",
    meta: {
      seedCount: entrantCapacity,
      seedRecommendationDiverged: decision.divergesFromRecommendation,
      systemTieResolution: decision.resolvesSystemTie,
      overrideReason: persistedOverrideReason,
    },
  });
}

export async function confirmMajorTournamentSeedsInTx(
  tx: TxDb,
  input: { seasonId: string; actorId: string },
): Promise<void> {
  const [season] = await tx.select().from(seasons)
    .where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const { entrantCapacity } = getStandardMajorDefinition(season);
  const state = await ensureMajorPrestartStateInTx(tx, season.id);
  if (state.seedsLockedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事已经正式开赛，不能重新确认赛事种子。 ");
  if (!state.entrantsLockedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先锁定正式参赛队和最终赛事名单。 ");

  const frozenSet = await loadCurrentFrozenSeedSetInTx(tx, season.id);
  const snapshot = await loadReadySnapshotInTx(tx, season.id, frozenSet.frozenSetFingerprint);

  const countResult = await tx.execute<{ seed_count: string; team_count: string }>(sql`
    SELECT count(*) AS seed_count, count(DISTINCT tournament_entrant_id) AS team_count
    FROM major_tournament_seeds WHERE season_id = ${season.id}
  `);
  const counts = countResult.rows[0];
  if (Number(counts?.seed_count) !== entrantCapacity || Number(counts?.team_count) !== entrantCapacity) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事种子不完整，不能确认。 ");
  }

  const seedRows = await tx.select({
    entrantId: majorTournamentEntrants.competitionEntryId,
    tournamentSeed: majorTournamentSeeds.seed,
  }).from(majorTournamentSeeds)
    .innerJoin(majorTournamentEntrants, eq(majorTournamentSeeds.tournamentEntrantId, majorTournamentEntrants.id))
    .where(eq(majorTournamentSeeds.seasonId, season.id))
    .orderBy(majorTournamentSeeds.seed);
  if (seedRows.some((row, index) => row.tournamentSeed !== index + 1)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `赛事种子必须完整且唯一覆盖 1–${entrantCapacity}。 `);
  }
  const decision = analyzeFinalSeedOrder(seedRows.map((row) => row.entrantId), snapshot.recommendations);
  if (decision.divergesFromRecommendation && !state.seedOverrideReason?.trim()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "最终种子偏离系统建议时，必须先保存人工调整原因。 ");
  }

  const now = new Date();
  await tx.update(majorPrestartStates).set({
    seedsConfirmedAt: now,
    seedsConfirmedBy: input.actorId,
    updatedAt: now,
  }).where(eq(majorPrestartStates.id, state.id));
  await tx.insert(auditLogs).values({
    seasonId: season.id,
    action: "major_prestart.confirm_tournament_seeds",
    actorId: input.actorId,
    targetId: state.id,
    targetType: "major_prestart_state",
    meta: {
      seedCount: entrantCapacity,
      seedRecommendationDiverged: decision.divergesFromRecommendation,
      systemTieResolution: decision.resolvesSystemTie,
      overrideReason: state.seedOverrideReason ?? null,
    },
  });
}
