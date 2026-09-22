import type { StagePlan } from "@/types/season";

interface StageMatch {
  stage: string;
  status: string;
  entryAId: string;
  entryBId: string;
}

export interface StageViewsResult<T extends StageMatch> {
  /** 只包含当前 StagePlan 已配置的阶段，顺序与配置完全一致。 */
  views: readonly { stage: StagePlan[number]; matches: readonly T[] }[];
  /**
   * 指向已不在当前 StagePlan 中的阶段的比赛。
   * 这些记录不能被猜测归属，也不能在展示层静默丢弃。
   */
  unconfiguredMatches: readonly T[];
}

export function buildStageViews<T extends StageMatch>(
  stagePlan: StagePlan,
  matches: readonly T[],
): StageViewsResult<T> {
  const configuredStageKeys = new Set(stagePlan.map((stage) => stage.key));
  const matchesByStage = new Map<string, T[]>();
  for (const match of matches) {
    if (!configuredStageKeys.has(match.stage)) continue;
    const stageMatches = matchesByStage.get(match.stage) ?? [];
    stageMatches.push(match);
    matchesByStage.set(match.stage, stageMatches);
  }

  return {
    views: stagePlan.map((stage) => ({
      stage,
      matches: matchesByStage.get(stage.key) ?? [],
    })),
    unconfiguredMatches: matches.filter((match) => !configuredStageKeys.has(match.stage)),
  };
}

export function resolveDefaultStageKey<T extends Pick<StageMatch, "stage">>(
  stagePlan: StagePlan,
  matches: readonly T[],
  requestedStage?: string,
): string | null {
  if (requestedStage && requestedStage !== "all" && stagePlan.some((stage) => stage.key === requestedStage)) {
    return requestedStage;
  }

  const stagesWithMatches = new Set(matches.map((match) => match.stage));
  return [...stagePlan].reverse().find((stage) => stagesWithMatches.has(stage.key))?.key
    ?? stagePlan[0]?.key
    ?? null;
}
