import type { BracketNodeProjection } from "@/lib/bracket";
import type { MajorSwissStageReadModel } from "@/lib/matches/stage-read-model";
import type { TeamStanding } from "@/lib/standings";
import type { StageConfig } from "@/types/season";
import type { OfficialStage } from "@/lib/seasons/official-stages";
import type { RivalHubRemoteStage, RivalHubRemoteStanding } from "./contracts";

export interface StageProjectionContext {
  standings?: readonly TeamStanding[];
  swissReadModel?: MajorSwissStageReadModel | null;
  bracketNodes?: readonly BracketNodeProjection[];
}

export function projectRoundRobinStandings(
  standings: readonly TeamStanding[],
): RivalHubRemoteStanding[] {
  return standings.map((standing) => ({
    entryId: standing.teamId,
    teamName: standing.teamName,
    rank: standing.seed,
    wins: standing.wins,
    losses: standing.losses,
    roundWins: standing.totalRoundsWon,
    roundLosses: standing.totalRoundsWon - standing.netRounds,
    roundDiff: standing.netRounds,
  }));
}

export function projectSwissStandings(
  readModel: MajorSwissStageReadModel,
): RivalHubRemoteStanding[] {
  return readModel.competitionEntries.map((entry) => ({
    entryId: entry.entryId,
    teamName: entry.teamName,
    rank: entry.seed,
    wins: entry.wins,
    losses: entry.losses,
    tiebreakFacts: { BU: entry.difficultyScore },
    status: entry.status,
  }));
}

export function projectBracketNodes(
  nodes: readonly BracketNodeProjection[],
): NonNullable<RivalHubRemoteStage["bracketNodes"]> {
  return nodes.map((node) => ({
    id: node.id,
    label: node.label,
    round: node.round,
    lane: node.lane,
    nextWinNodeId: node.nextWinNodeId,
    nextLossNodeId: node.nextLossNodeId,
  }));
}

export function projectStage(
  stage: StageConfig,
  context: StageProjectionContext = {},
): RivalHubRemoteStage {
  const stageStandings = context.swissReadModel
    ? projectSwissStandings(context.swissReadModel)
    : context.standings
      ? projectRoundRobinStandings(context.standings)
      : undefined;
  const bracketNodes = context.bracketNodes && context.bracketNodes.length > 0
    ? projectBracketNodes(context.bracketNodes)
    : undefined;
  return {
    key: stage.key,
    name: stage.name,
    type: stageType(stage.type),
    teamCount: stage.teamCount,
    advanceCount: stage.advanceTiers.reduce((sum, tier) => sum + tier.count, 0),
    matchFormat: stage.matchFormat ?? null,
    finalFormat: stage.finalFormat ?? null,
    ...(stageStandings && stageStandings.length > 0 ? { standings: stageStandings } : {}),
    ...(bracketNodes ? { bracketNodes } : {}),
  };
}

/** Existing v1 consumers accept known formats only. Never invent rules for
 * an orphan historical key; contract evolution is separate from this fix. */
export function projectOfficialStage(stage: OfficialStage): RivalHubRemoteStage | null {
  if (stage.config) return projectStage(stage.config);
  if (!stage.qualification) return null;
  return {
    key: stage.key, name: stage.name,
    type: stage.qualification.format === "short_swiss_2w2l" ? "swiss" : "single_elim",
    teamCount: stage.qualification.playInEntryCount,
    advanceCount: stage.qualification.qualifierCount,
    matchFormat: stage.qualification.format === "short_swiss_2w2l" ? "bo1" : "bo3", finalFormat: null,
  };
}

function stageType(type: string): RivalHubRemoteStage["type"] {
  return type === "round_robin" || type === "swiss" || type === "single_elim" || type === "double_elim" || type === "gsl_group"
    ? type
    : "round_robin";
}
