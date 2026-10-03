import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { TxDb } from "@/db/client";
import { matches, matchMaps, matchLiveSessions } from "@/db/schema";
import { lockMatchInTx } from "@/lib/match-rosters/service";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { computeSeriesScoreAfterMap, validateMapScore } from "./result-rules";

export const mapCorrectionReviewSchema = z.strictObject({
  expectedScoreA: z.number().int().nonnegative(), expectedScoreB: z.number().int().nonnegative(),
  reason: z.string().trim().min(1, "请填写更正原因。").max(500),
});

/** Same official-result owner for ongoing and finished series; match → source locks. */
export async function correctMapScoreInTx(tx: TxDb, input: {
  matchId: string; mapId: string; scoreA: number; scoreB: number; actorId: string;
  review: z.infer<typeof mapCorrectionReviewSchema>;
}) {
  validateMapScore(input.scoreA, input.scoreB);
  const review = mapCorrectionReviewSchema.parse(input.review);
  const match = await lockMatchInTx(tx, input.matchId);
  await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
  if (!["in_progress", "finished"].includes(match.status) || match.isForfeit) throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "请在已开赛的正常比赛中更正地图比分。");
  const [source] = await tx.select().from(matchLiveSessions).where(and(eq(matchLiveSessions.matchId, match.id), isNull(matchLiveSessions.closedAt))).for("update");
  const maps = await tx.query.matchMaps.findMany({ where: eq(matchMaps.matchId, match.id) });
  const map = maps.find(row => row.id === input.mapId);
  if (!map?.completedAt || map.scoreA === null || map.scoreB === null) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先提交本图正式比分。");
  if (map.scoreA === input.scoreA && map.scoreB === input.scoreB) return;
  if (map.scoreA !== review.expectedScoreA || map.scoreB !== review.expectedScoreB) throw new AppError(ErrorCode.VALIDATION_FAILED, "正式比分已更新，请重新核对后提交。");
  if (maps.some(row => (row.scoreA === null) !== (row.scoreB === null))) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先补齐地图比分记录。");
  const { mapWinsA, mapWinsB, seriesFinished } = computeSeriesScoreAfterMap(match.format, maps.filter(row => row.id !== map.id), input.scoreA, input.scoreB);
  if (match.status === "finished") {
    if (!seriesFinished || mapWinsA === mapWinsB) throw new AppError(ErrorCode.VALIDATION_FAILED, "修正后系列赛无法构成完整比分，请使用整场结果更正。");
    if ((match.scoreA! > match.scoreB!) !== (mapWinsA > mapWinsB)) throw new AppError(ErrorCode.VALIDATION_FAILED, "本次修改将改变比赛胜者，请使用整场结果更正并核对后续赛程。");
  } else if (seriesFinished) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "本次修改将提前结束系列赛，请先核对已进行地图并处理整场赛果。");
  }
  await tx.update(matchMaps).set({ scoreA: input.scoreA, scoreB: input.scoreB }).where(eq(matchMaps.id, map.id));
  // Match-level scores are final series results; ongoing wins are derived from maps.
  await tx.update(matches).set({ ...(match.status === "finished" ? { scoreA: mapWinsA, scoreB: mapWinsB } : {}), updatedAt: new Date() }).where(eq(matches.id, match.id));
  // Existing Demo evidence revisions include canonical scores. A correction makes
  // affected imports need revalidation without rewriting gameplay or lineage.
  if (source?.currentMapId === map.id) await tx.update(matchLiveSessions).set({ autoCanonicalizationArmed: false, continuityHealth: "result_conflict" }).where(eq(matchLiveSessions.id, source.id));
  await writeAuditInTx(tx, { seasonId: match.seasonId, actorId: input.actorId, action: "match.correct_map_score", targetId: match.id,
    meta: { mapId: map.id, mapName: map.mapName, prevScoreA: map.scoreA, prevScoreB: map.scoreB, scoreA: input.scoreA, scoreB: input.scoreB, seriesA: mapWinsA, seriesB: mapWinsB, reason: review.reason } });
}
