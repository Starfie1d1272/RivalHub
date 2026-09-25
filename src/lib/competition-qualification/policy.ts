import { AppError, ErrorCode } from "@/lib/errors";

export type CompetitionQualificationFormat = "direct_bo3" | "short_swiss_2w2l";

export const SHORT_SWISS_WIN_THRESHOLD = 2;
export const SHORT_SWISS_LOSS_THRESHOLD = 2;
export const SHORT_SWISS_MAX_ROUNDS = SHORT_SWISS_WIN_THRESHOLD + SHORT_SWISS_LOSS_THRESHOLD - 1;

export interface CompetitionQualificationPlan {
  targetEntrantCount: number;
  candidateCount: number;
  directEntryCount: number;
  playInEntryCount: number;
  qualifierCount: number;
}

export interface QualificationCandidateOrderInput {
  entryId: string;
  teamName: string;
  displayOrder: number | null;
}

export function deriveCompetitionQualificationPlan(
  candidateCount: number,
  targetEntrantCount: number,
): CompetitionQualificationPlan {
  if (!Number.isInteger(candidateCount) || !Number.isInteger(targetEntrantCount) || targetEntrantCount < 1) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "报名人数或正赛规模无效。");
  }
  if (candidateCount <= targetEntrantCount) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "已批准报名队伍数未超过正赛容量，无需配置 Play-in。");
  }
  if (candidateCount > targetEntrantCount * 2) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "当前报名规模无法通过单层 Play-in 收敛到目标正赛规模。");
  }
  const qualifierCount = candidateCount - targetEntrantCount;
  const playInEntryCount = qualifierCount * 2;
  const directEntryCount = targetEntrantCount - qualifierCount;
  return {
    targetEntrantCount,
    candidateCount,
    directEntryCount,
    playInEntryCount,
    qualifierCount,
  };
}

export function isShortSwissQualificationAllowed(playInEntryCount: number): boolean {
  return playInEntryCount >= 4 && playInEntryCount % 4 === 0;
}

export const SHORT_SWISS_DISABLED_NOTE = "Short Swiss 需要 Play-in 队伍数为 4 的倍数。";

/** Recommended strength order first; entries without a recommendation use stable alphabetical order. */
export function orderQualificationCandidates<T extends QualificationCandidateOrderInput>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort((a, b) => {
    const aRanked = a.displayOrder !== null;
    const bRanked = b.displayOrder !== null;
    if (aRanked && bRanked && a.displayOrder !== b.displayOrder) {
      return a.displayOrder! - b.displayOrder!;
    }
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    return a.teamName.localeCompare(b.teamName, "zh-CN") || a.entryId.localeCompare(b.entryId);
  });
}

/** Selecting a occupied rank swaps its current occupant into the previous rank. */
export function swapQualificationPreliminaryRank(
  orderedEntryIds: readonly string[],
  entryId: string,
  nextRank: number,
): string[] {
  if (new Set(orderedEntryIds).size !== orderedEntryIds.length || !orderedEntryIds.includes(entryId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "报名候选队伍集合已变化，请刷新后重试。");
  }
  if (!Number.isInteger(nextRank) || nextRank < 1 || nextRank > orderedEntryIds.length) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `预排名必须在 1..${orderedEntryIds.length} 之间。`);
  }
  const currentRank = orderedEntryIds.indexOf(entryId) + 1;
  if (currentRank === nextRank) return [...orderedEntryIds];
  const next = [...orderedEntryIds];
  [next[currentRank - 1], next[nextRank - 1]] = [next[nextRank - 1]!, next[currentRank - 1]!];
  return next;
}
