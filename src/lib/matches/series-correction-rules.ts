import type { MatchFormat } from "@/types/match";
import { getWinThreshold } from "@/types/match";
import { AppError, ErrorCode } from "@/lib/errors";
import { validateMapScore, validateSeriesScore } from "./result-rules";

export interface SeriesCorrectionMapFact {
  id: string; mapOrder: number; mapName: string;
  scoreA: number | null; scoreB: number | null; completedAt: Date | null;
}

/** Ordered actual results, never a sum that can hide games after the clincher. */
export function planEarlySeriesFinish(format: MatchFormat, maps: readonly SeriesCorrectionMapFact[], correction: { mapId: string; scoreA: number; scoreB: number }) {
  validateMapScore(correction.scoreA, correction.scoreB);
  const ordered = [...maps].sort((a, b) => a.mapOrder - b.mapOrder);
  const corrected = ordered.find(map => map.id === correction.mapId);
  if (!corrected?.completedAt || corrected.scoreA === null || corrected.scoreB === null) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先提交本图正式比分。");
  let currentA = 0, currentB = 0, scoreA = 0, scoreB = 0;
  let clinchingOrder: number | null = null;
  let completedAt: Date | null = null;
  const blockers: string[] = [];
  const threshold = getWinThreshold(format);
  for (const [index, map] of ordered.entries()) {
    if (map.mapOrder !== index + 1) throw new AppError(ErrorCode.VALIDATION_FAILED, "地图顺序不完整，请先核对已进行地图。");
    const scored = map.scoreA !== null && map.scoreB !== null;
    if (scored !== Boolean(map.completedAt) || (map.scoreA === null) !== (map.scoreB === null)) throw new AppError(ErrorCode.VALIDATION_FAILED, "地图比分记录不完整，请先核对。");
    if (!scored) {
      if (ordered.slice(index + 1).some(row => row.completedAt)) throw new AppError(ErrorCode.VALIDATION_FAILED, "地图结果不连续，请先核对已进行地图。");
      continue;
    }
    validateMapScore(map.scoreA!, map.scoreB!);
    if (map.scoreA! > map.scoreB!) currentA++; else currentB++;
    if (clinchingOrder !== null) {
      blockers.push(`Map ${map.mapOrder} 已有正式结果，请先处理实际比赛事实。`);
      continue;
    }
    const a = map.id === correction.mapId ? correction.scoreA : map.scoreA!;
    const b = map.id === correction.mapId ? correction.scoreB : map.scoreB!;
    if (a > b) scoreA++; else scoreB++;
    if (scoreA === threshold || scoreB === threshold) { clinchingOrder = map.mapOrder; completedAt = map.completedAt; }
  }
  if (clinchingOrder === null) return null;
  // A scored later map is reported as a conflict even if the stored series was
  // already inconsistent. Never let that inconsistency hide the recovery block.
  if (!blockers.length && (currentA >= threshold || currentB >= threshold)) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前地图结果已构成完赛，请先核对整场记录。");
  validateSeriesScore(format, scoreA, scoreB);
  return { currentA, currentB, scoreA, scoreB, clinchingOrder, completedAt: completedAt!, blockers };
}
