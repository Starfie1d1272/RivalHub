import { eq, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  majorPrestartStates,
  majorSeedRecommendationSnapshots,
  majorTournamentEntrants,
  majorTournamentSeeds,
  seasons,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";
import {
  analyzeFinalSeedOrder,
  isSeedRecommendationSnapshotPayloadV1,
} from "@/lib/major/team-seed-recommendation";

export interface SaveMajorTournamentSeedsInTxInput {
  seasonId: string;
  entryIds: readonly string[];
  overrideReason: string | null;
  actorId: string;
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

  const entrants = await tx.select({
    id: majorTournamentEntrants.id,
    entryId: majorTournamentEntrants.competitionEntryId,
  }).from(majorTournamentEntrants)
    .where(eq(majorTournamentEntrants.seasonId, season.id));
  const entrantsByEntryId = new Map(entrants.map((entrant) => [entrant.entryId, entrant]));
  if (
    new Set(input.entryIds).size !== input.entryIds.length ||
    input.entryIds.length !== entrantCapacity ||
    entrantsByEntryId.size !== entrantCapacity ||
    input.entryIds.some((entryId) => !entrantsByEntryId.has(entryId))
  ) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `赛事种子必须且只能覆盖已锁定的 ${entrantCapacity} 支正式参赛队。 `);
  }

  const [snapshot] = await tx.select().from(majorSeedRecommendationSnapshots)
    .where(eq(majorSeedRecommendationSnapshots.seasonId, season.id));
  if (!snapshot || !isSeedRecommendationSnapshotPayloadV1(snapshot.context, snapshot.recommendations)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "系统种子建议快照尚未生成或已损坏，不能保存最终种子。 ");
  }

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

  const countResult = await tx.execute<{ seed_count: string; team_count: string }>(sql`
    SELECT count(*) AS seed_count, count(DISTINCT tournament_entrant_id) AS team_count
    FROM major_tournament_seeds WHERE season_id = ${season.id}
  `);
  const counts = countResult.rows[0];
  if (Number(counts?.seed_count) !== entrantCapacity || Number(counts?.team_count) !== entrantCapacity) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事种子不完整，不能确认。 ");
  }

  const [snapshot] = await tx.select().from(majorSeedRecommendationSnapshots)
    .where(eq(majorSeedRecommendationSnapshots.seasonId, season.id));
  if (!snapshot || !isSeedRecommendationSnapshotPayloadV1(snapshot.context, snapshot.recommendations)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "系统种子建议快照尚未生成或已损坏，不能确认最终种子。 ");
  }
  const seedRows = await tx.select({
    entrantId: majorTournamentEntrants.competitionEntryId,
    tournamentSeed: majorTournamentSeeds.seed,
  }).from(majorTournamentSeeds)
    .innerJoin(majorTournamentEntrants, eq(majorTournamentSeeds.tournamentEntrantId, majorTournamentEntrants.id))
    .where(eq(majorTournamentSeeds.seasonId, season.id))
    .orderBy(majorTournamentSeeds.seed);
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
