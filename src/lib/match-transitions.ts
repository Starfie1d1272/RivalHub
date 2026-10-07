import { AppError, ErrorCode } from "@/lib/errors";

export type MatchStatus = "scheduled" | "in_progress" | "finished" | "cancelled";

export const MATCH_TRANSITIONS: Partial<Record<`${MatchStatus}→${MatchStatus}`, true>> = {
  "scheduled→in_progress": true,
  "scheduled→cancelled": true,
  "scheduled→finished": true,
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

export { resolveMatchFormat } from "./matches/competition-format";
