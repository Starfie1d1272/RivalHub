import { AppError, ErrorCode } from "@/lib/errors";
import { assertMatchTransition } from "@/lib/match-transitions";
import type { MatchFormat, MatchStatus } from "@/types/match";
import { validateSeriesScore } from "./result-rules";

/** The execution kernel has no competition, team registry, roster or telemetry prerequisites. */
export interface MatchExecution {
  status: MatchStatus;
  startedAt: Date | null;
  completedAt: Date | null;
}

export function transitionMatchExecution(
  match: MatchExecution,
  nextStatus: "in_progress" | "cancelled",
  now: Date,
) {
  assertMatchTransition(match.status, nextStatus);
  return {
    status: nextStatus,
    ...(nextStatus === "in_progress" && match.startedAt === null ? { startedAt: now } : {}),
    updatedAt: now,
  };
}

export type MatchConclusion =
  | { kind: "recorded"; scoreA: number; scoreB: number }
  | { kind: "pending" }
  | { kind: "omitted" };

/** Ending execution and choosing whether to record a result are separate facts. */
export function concludeMatchExecution(
  match: MatchExecution & { format: MatchFormat },
  conclusion: MatchConclusion,
  now: Date,
) {
  if (match.status === "cancelled") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "已取消的比赛不能直接提交结束结果。");
  // Result corrections may replace a finished result without reopening execution.
  if (match.status !== "finished") assertMatchTransition(match.status, "finished");
  if (conclusion.kind === "recorded") validateSeriesScore(match.format, conclusion.scoreA, conclusion.scoreB);
  return {
    status: "finished" as const,
    completedAt: now,
    result: conclusion,
    scoreA: conclusion.kind === "recorded" ? conclusion.scoreA : null,
    scoreB: conclusion.kind === "recorded" ? conclusion.scoreB : null,
  };
}
