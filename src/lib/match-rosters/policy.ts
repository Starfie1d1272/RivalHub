import type { Match } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { parseMajorRunSnapshot } from "@/lib/major/run-snapshot";

export interface MatchLineupPolicy {
  starterCount: number;
  maxSubstitutes: number;
}

function validStarterCount(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Single owner for match-lineup cardinality. Major consumes the StageRun input
 * frozen at launch; every other competition consumes its published season rule.
 */
export function resolveMatchLineupPolicy(input: {
  ownership: Match["ownership"];
  seasonStarterCount: number;
  majorStageRun?: { stageKey: string; ruleSnapshot: unknown } | null;
}): MatchLineupPolicy {
  if (input.ownership !== "major_stage") {
    if (!validStarterCount(input.seasonStarterCount)) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "赛季首发人数配置不可用。");
    }
    return { starterCount: input.seasonStarterCount, maxSubstitutes: 2 };
  }

  if (!input.majorStageRun) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "托管比赛缺少冻结的 StageRun 名单规则。");
  }
  const snapshot = parseMajorRunSnapshot(
    input.majorStageRun.ruleSnapshot,
    input.majorStageRun.stageKey,
  );
  if (!validStarterCount(snapshot.rosterRules.starterCount)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的首发人数规则不可用。");
  }
  return { starterCount: snapshot.rosterRules.starterCount, maxSubstitutes: 0 };
}
