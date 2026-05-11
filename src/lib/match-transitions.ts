import { AppError, ErrorCode } from "@/lib/errors";
import { normalizeStagePlan } from "@/types/season";

export type MatchStatus = "scheduled" | "in_progress" | "finished" | "cancelled";

export const MATCH_TRANSITIONS: Partial<Record<`${MatchStatus}→${MatchStatus}`, true>> = {
  "scheduled→in_progress": true,
  "scheduled→cancelled": true,
  "in_progress→finished": true,
  "in_progress→cancelled": true,
};

export function assertMatchTransition(current: MatchStatus, next: MatchStatus): void {
  const key = `${current}→${next}` as `${MatchStatus}→${MatchStatus}`;
  if (!MATCH_TRANSITIONS[key]) {
    throw new AppError(
      ErrorCode.MATCH_INVALID_TRANSITION,
      `比赛状态不允许从 ${current} 变更为 ${next}`,
    );
  }
}

/** 根据阶段配置和轮次决定比赛格式（淘汰赛决赛可用 finalFormat 覆写为 BO5） */
export function resolveMatchFormat(
  stagePlan: ReturnType<typeof normalizeStagePlan>,
  stageKey: string,
  roundNumber: number,
): "bo1" | "bo3" | "bo5" {
  const sc = stagePlan.find((s) => s.key === stageKey);
  if (!sc) return "bo3";
  // 使用 2^n 对齐的实际 bracket 大小，而非配置的参赛队数，
  // 确保非 2 的幂队数（如 6 队含 bye）时 finalFormat 也能正确生效。
  let bracketSize = 1;
  while (bracketSize < sc.teamCount) bracketSize <<= 1;
  const totalRounds = Math.log2(bracketSize);
  if (roundNumber === totalRounds && sc.finalFormat) return sc.finalFormat;
  return sc.matchFormat ?? "bo3";
}
