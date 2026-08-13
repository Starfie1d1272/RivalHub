import type { BracketData } from "@/lib/bracket";
import type { SwissViewData } from "@/lib/swiss/data";
import { getFirstStageOfType, getPreviousStage, type StagePlan } from "@/types/season";

interface StageMatch {
  stage: string;
  status: string;
  teamAId: string;
  teamBId: string;
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

/**
 * Legacy GeneratePlayoff/SyncBracket controls only understand a direct
 * qualifier → playoff flow. This is a UI safety gate, not tournament runtime state.
 */
export function hasAdjacentLegacyQualifierPlayoff(stagePlan: StagePlan): boolean {
  const qualifierStage = getFirstStageOfType(stagePlan, ["round_robin", "swiss"]);
  const playoffStage = getFirstStageOfType(stagePlan, ["double_elim", "single_elim"]);
  return !!qualifierStage && getPreviousStage(stagePlan, playoffStage?.key ?? "")?.key === qualifierStage.key;
}

/**
 * 仅供积分榜等展示投影使用：从当前已有比赛中提取出现过的队伍。
 * 这不是 canonical StageEntrants；轮空、部分生成或未来阶段的队伍均可能不在其中。
 */
export function getTeamsReferencedByMatches<T extends { id: string }>(
  teams: readonly T[],
  stageMatches: readonly Pick<StageMatch, "teamAId" | "teamBId">[],
): T[] {
  const teamIds = new Set(stageMatches.flatMap((match) => [match.teamAId, match.teamBId]));
  return teams.filter((team) => teamIds.has(team.id));
}

/**
 * Legacy presentation adapter：现有 brackets-manager 数据只能按 stage.name 筛选。
 * name 不是稳定领域 identity；不得将该行为扩展为新的 bracket/domain contract。
 */
export type LegacyBracketProjection =
  | { status: "ok"; data: BracketData }
  | { status: "missing" }
  | { status: "ambiguous" };

export function projectLegacyBracketByStageName(
  data: BracketData,
  stageName: string,
): LegacyBracketProjection {
  const bracketStages = data.stage.filter((stage) => stage.name === stageName);
  if (bracketStages.length === 0) return { status: "missing" };
  if (bracketStages.length > 1) return { status: "ambiguous" };

  const stageIds = new Set(bracketStages.map((stage) => stage.id));
  const matchIds = new Set(data.match.filter((match) => stageIds.has(match.stage_id)).map((match) => match.id));

  return {
    status: "ok",
    data: {
      ...data,
      stage: bracketStages,
      match: data.match.filter((match) => stageIds.has(match.stage_id)),
      match_game: data.match_game.filter((game) => matchIds.has(game.parent_id)),
      group: data.group.filter((group) => stageIds.has(group.stage_id)),
      round: data.round.filter((round) => stageIds.has(round.stage_id)),
    },
  };
}

/**
 * Legacy Swiss projection 仅在 standings 能完整覆盖当前比赛队伍时展示。
 * 它不是新的 Swiss truth source；不完整时调用方必须退回通用比赛列表。
 */
export function canUseLegacySwissView(
  stage: StagePlan[number],
  stageMatches: readonly Pick<StageMatch, "teamAId" | "teamBId">[],
  swissData: SwissViewData | undefined,
): swissData is SwissViewData {
  if (stage.type !== "swiss" || stageMatches.length === 0 || !swissData) return false;
  if (swissData.teamCount !== stage.teamCount || swissData.teams.length !== stage.teamCount) return false;

  const standingTeamIds = new Set(swissData.teams.map((team) => team.teamId));
  return stageMatches.every(
    (match) => standingTeamIds.has(match.teamAId) && standingTeamIds.has(match.teamBId),
  );
}
