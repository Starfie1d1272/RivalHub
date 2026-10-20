import { and, eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  betMarkets,
  betStakes,
  eventRosters,
  majorPrestartStates,
  majorSeedRecommendationSnapshots,
  majorStageRuns,
  majorTournamentEntrants,
  majorTournamentSeeds,
  seasons,
} from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { assertPrestartEntryCoherenceInTx } from "@/lib/event-rosters/coherence";
import { AppError, ErrorCode } from "@/lib/errors";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";

/**
 * Revert only the *pre-seeding* Major freeze. The entrant set and every
 * approved CompetitionEntry revision are retained, while the obsolete seed
 * recommendation snapshot is discarded for regeneration on the next freeze.
 *
 * Keep the order season -> prestart state -> Entry/EventRoster. The DB trigger
 * permits thawing only inside this transaction after the global lock is gone.
 */
export async function rollbackMajorPrestartEntrantsInTx(
  tx: TxDb,
  input: { seasonId: string; actorId: string; reopenUntil: Date; reason: string },
): Promise<{ seasonSlug: string; reopenedRosterCount: number }> {
  const reason = input.reason.trim();
  if (!reason) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写撤回冻结的原因。");
  const now = new Date();
  if (!Number.isFinite(input.reopenUntil.getTime()) || input.reopenUntil <= now) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "请设置晚于当前时间的名单调整截止。");
  }

  const [season] = await tx.select().from(seasons)
    .where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。");
  if (season.status !== "registration") {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前赛事已进入运行阶段，不能撤回冻结。");
  }
  const { entrantCapacity } = getStandardMajorDefinition(season);
  const state = await ensureMajorPrestartStateInTx(tx, season.id);
  if (!state.entrantsLockedAt) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "正式名单尚未冻结。");
  }
  if (state.seedsLockedAt || state.seedsConfirmedAt) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事种子已经确认或正赛已开始，不能撤回冻结。");
  }
  const [savedSeed] = await tx.select({ id: majorTournamentSeeds.id })
    .from(majorTournamentSeeds).where(eq(majorTournamentSeeds.seasonId, season.id)).limit(1);
  const [stageRun] = await tx.select({ id: majorStageRuns.id })
    .from(majorStageRuns).where(eq(majorStageRuns.seasonId, season.id)).limit(1);
  if (savedSeed || stageRun) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已有正式种子或正赛运行记录，不能撤回冻结。");
  }

  const entrantRefs = await tx.select({ entryId: majorTournamentEntrants.competitionEntryId })
    .from(majorTournamentEntrants).where(eq(majorTournamentEntrants.seasonId, season.id));
  if (entrantRefs.length !== entrantCapacity) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "正赛参赛队集合不完整，不能撤回冻结。");
  }
  const coherent = await assertPrestartEntryCoherenceInTx(tx, season.id,
    entrantRefs.map((row) => ({ competitionEntryId: row.entryId })));
  if (coherent.length !== entrantCapacity || coherent.some((row) => row.eventRoster.status !== "frozen")) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "正式赛事名单状态不一致，不能撤回冻结。");
  }

  // Top Fragger terms include frozen player IDs. A wagered player market
  // requires an explicit financial correction; never strand paid stakes.
  const [playerWager] = await tx.select({ id: betStakes.id }).from(betStakes)
    .innerJoin(betMarkets, eq(betStakes.marketId, betMarkets.id))
    .where(and(eq(betMarkets.seasonId, season.id), eq(betMarkets.type, "top_fragger")))
    .limit(1);
  if (playerWager) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事击杀王盘口已有投注，请先执行带退款的赛务更正。");
  }
  const [snapshot] = await tx.select().from(majorSeedRecommendationSnapshots)
    .where(eq(majorSeedRecommendationSnapshots.seasonId, season.id)).for("update");
  if (!snapshot) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "冻结种子快照缺失，请先排查赛前数据。");
  }

  // The old frozen fingerprint is no longer valid once a roster is editable.
  await tx.delete(majorSeedRecommendationSnapshots).where(eq(majorSeedRecommendationSnapshots.seasonId, season.id));
  await tx.update(majorPrestartStates).set({
    entrantsLockedAt: null, entrantsLockedBy: null, updatedAt: now,
  }).where(eq(majorPrestartStates.id, state.id));

  await tx.execute(sql`select set_config('rivalhub.major_entrant_rollback', 'on', true)`);
  const reopened = await tx.update(eventRosters).set({
    status: "confirmed", frozenAt: null, frozenBy: null, updatedAt: now,
  }).where(inArray(eventRosters.id, coherent.map((row) => row.eventRoster.id)))
    .returning({ id: eventRosters.id });
  if (reopened.length !== entrantCapacity) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "未能完整恢复所有正式赛事名单。");
  }

  await tx.update(seasons).set({ rosterChangeClosesAt: input.reopenUntil, updatedAt: now })
    .where(eq(seasons.id, season.id));
  await writeAuditInTx(tx, {
    seasonId: season.id,
    action: "major_prestart.unlock_entrants",
    actorId: input.actorId,
    targetId: state.id,
    meta: {
      reason,
      previousLockedAt: state.entrantsLockedAt.toISOString(),
      previousLockedBy: state.entrantsLockedBy,
      previousRosterChangeClosesAt: season.rosterChangeClosesAt?.toISOString() ?? null,
      nextRosterChangeClosesAt: input.reopenUntil.toISOString(),
      previousSnapshotId: snapshot.id,
      previousSnapshotFingerprint: snapshot.entrantSetFingerprint,
      reopenedRosterCount: reopened.length,
    },
  });
  return { seasonSlug: season.slug, reopenedRosterCount: reopened.length };
}
