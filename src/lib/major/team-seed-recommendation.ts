import {
  getPlayerStrengthBreakdown,
  type PlayerStrengthBreakdown,
  type PlayerStrengthInput,
} from "./player-strength";

/** Team scores are persisted at the smallest precision produced by five 50/20/30 weighted ranks. */
export const TEAM_SEED_STRENGTH_SCALE = 100 as const;

export type SeedOrderRowStatus = "aligned" | "tie_resolved" | "adjusted" | "unsaved";

export interface TeamSeedRecommendationInput {
  teamId: string;
  teamName: string;
  starters: readonly PlayerStrengthInput[];
}

export interface TeamSeedRecommendation {
  teamId: string;
  teamName: string;
  available: boolean;
  blockers: string[];
  teamSeedStrength: number | null;
  /** Canonical integer used for sorting and exact tie comparison. */
  teamSeedStrengthScaled: number | null;
  recommendationRank: number | null;
  tieGroup: number | null;
  /** Deterministic display order only; it never changes rank or tieGroup. */
  displayOrder: number | null;
  starters: Array<{
    userId: string;
    label: string;
    input: PlayerStrengthInput;
    breakdown: PlayerStrengthBreakdown;
  }>;
}

export interface SeedRecommendationOrderItem {
  competitionEntryId: string;
  recommendationRank: number | null;
  tieGroup: number | null;
  displayOrder: number | null;
}

export interface SeedOrderDecision {
  divergesFromRecommendation: boolean;
  resolvesSystemTie: boolean;
  recommendationOrder: string[];
  finalOrder: string[];
  finalSeedByTeamId: Record<string, number | null>;
  rowStatusByTeamId: Record<string, SeedOrderRowStatus>;
}

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareDisplayOrder(left: TeamSeedRecommendation, right: TeamSeedRecommendation): number {
  return compareStrings(left.teamName, right.teamName) || compareStrings(left.teamId, right.teamId);
}

/**
 * Pure owner for the stage-4 system recommendation. A team is rankable only
 * when its frozen EventRoster contributes exactly five primary starters with
 * complete canonical PlayerStrength evidence.
 */
export function buildTeamSeedRecommendations(
  inputs: readonly TeamSeedRecommendationInput[],
  config: Parameters<typeof getPlayerStrengthBreakdown>[1],
): TeamSeedRecommendation[] {
  const rows: TeamSeedRecommendation[] = inputs.map((input) => {
    const starters = input.starters.map((starter) => ({
      userId: starter.userId,
      label: starter.label,
      input: starter,
      breakdown: getPlayerStrengthBreakdown(starter, config),
    }));
    const blockers = starters.flatMap((starter) =>
      starter.breakdown.blockers.map((blocker) => `${starter.label}：${blocker}`),
    );
    if (input.starters.length !== 5) {
      blockers.unshift(`必须提供恰好 5 名冻结主力，当前为 ${input.starters.length} 名。`);
    }
    const available = blockers.length === 0 && starters.every((starter) => starter.breakdown.available);
    const teamSeedStrengthScaled = available
      ? Math.round(starters.reduce((sum, starter) => sum + starter.breakdown.weightedRank!, 0) * TEAM_SEED_STRENGTH_SCALE / 5)
      : null;
    return {
      teamId: input.teamId,
      teamName: input.teamName,
      available,
      blockers: [...new Set(blockers)],
      teamSeedStrength: teamSeedStrengthScaled === null ? null : teamSeedStrengthScaled / TEAM_SEED_STRENGTH_SCALE,
      teamSeedStrengthScaled,
      recommendationRank: null,
      tieGroup: null,
      displayOrder: null,
      starters,
    };
  });

  const availableRows = rows
    .filter((row) => row.available && row.teamSeedStrengthScaled !== null)
    .sort((left, right) => right.teamSeedStrengthScaled! - left.teamSeedStrengthScaled! || compareDisplayOrder(left, right));
  let previousStrengthScaled: number | null = null;
  let rank = 0;
  let tieGroup = 0;
  for (const [index, row] of availableRows.entries()) {
    if (previousStrengthScaled === null || row.teamSeedStrengthScaled !== previousStrengthScaled) {
      rank = index + 1;
      tieGroup += 1;
      previousStrengthScaled = row.teamSeedStrengthScaled;
    }
    row.recommendationRank = rank;
    row.tieGroup = tieGroup;
    row.displayOrder = index + 1;
  }

  const unavailableRows = rows.filter((row) => !row.available || row.teamSeedStrengthScaled === null).sort(compareDisplayOrder);
  return [...availableRows, ...unavailableRows];
}

/**
 * Canonical final-order analysis. The UI consumes the row statuses from this
 * projection; it must not compare final and recommendation arrays itself.
 */
export function analyzeFinalSeedOrder(
  finalTeamIds: readonly string[],
  recommendations: readonly SeedRecommendationOrderItem[],
): SeedOrderDecision {
  const recommendationByTeamId = new Map(recommendations.map((recommendation) => [recommendation.competitionEntryId, recommendation]));
  const recommendationOrder = [...recommendations]
    .filter((recommendation) => recommendation.recommendationRank !== null && recommendation.displayOrder !== null)
    .sort((left, right) => left.displayOrder! - right.displayOrder!)
    .map((recommendation) => recommendation.competitionEntryId);
  const finalOrder = [...finalTeamIds];
  const recommendationTeamIds = new Set(recommendationOrder);
  const hasCompleteFinalOrder = finalOrder.length === recommendationOrder.length
    && new Set(finalOrder).size === finalOrder.length
    && finalOrder.every((teamId) => recommendationTeamIds.has(teamId));
  const exactOrderMatches = hasCompleteFinalOrder && finalOrder.every((teamId, index) => teamId === recommendationOrder[index]);
  const finalGroupOrder = finalOrder.map((teamId) => {
    const recommendation = recommendationByTeamId.get(teamId);
    return recommendation ? `${recommendation.recommendationRank}:${recommendation.tieGroup}` : null;
  });
  const recommendationGroupOrder = recommendationOrder.map((teamId) => {
    const recommendation = recommendationByTeamId.get(teamId)!;
    return `${recommendation.recommendationRank}:${recommendation.tieGroup}`;
  });
  const followsSystemGroups = hasCompleteFinalOrder
    && finalGroupOrder.length === recommendationGroupOrder.length
    && finalGroupOrder.every((group, index) => group === recommendationGroupOrder[index]);
  const tieGroupSizes = new Map<number, number>();
  for (const recommendation of recommendations) {
    if (recommendation.tieGroup !== null) tieGroupSizes.set(recommendation.tieGroup, (tieGroupSizes.get(recommendation.tieGroup) ?? 0) + 1);
  }
  const finalSeedByTeamId = Object.fromEntries(recommendations.map((recommendation) => [recommendation.competitionEntryId, null])) as Record<string, number | null>;
  for (const [index, teamId] of finalOrder.entries()) {
    if (teamId in finalSeedByTeamId) finalSeedByTeamId[teamId] = index + 1;
  }
  const rowStatusByTeamId = Object.fromEntries(recommendations.map((recommendation) => {
    const finalSeed = finalSeedByTeamId[recommendation.competitionEntryId];
    const finalIndex = finalSeed === null ? null : finalSeed - 1;
    const finalGroup = finalIndex === null ? null : finalGroupOrder[finalIndex];
    const expectedGroup = finalIndex === null ? null : recommendationGroupOrder[finalIndex];
    let status: SeedOrderRowStatus = "unsaved";
    if (hasCompleteFinalOrder && finalSeed !== null) {
      if (exactOrderMatches) {
        status = "aligned";
      } else if (followsSystemGroups) {
        status = recommendation.tieGroup !== null && (tieGroupSizes.get(recommendation.tieGroup) ?? 0) > 1
          ? "tie_resolved"
          : "aligned";
      } else {
        // Cross-group changes are classified by the row's final slot, not
        // propagated to every persisted team in the tournament.
        status = finalGroup === expectedGroup ? "aligned" : "adjusted";
      }
    }
    return [recommendation.competitionEntryId, status];
  })) as Record<string, SeedOrderRowStatus>;
  return {
    divergesFromRecommendation: hasCompleteFinalOrder && !followsSystemGroups,
    resolvesSystemTie: hasCompleteFinalOrder && followsSystemGroups && !exactOrderMatches,
    recommendationOrder,
    finalOrder,
    finalSeedByTeamId,
    rowStatusByTeamId,
  };
}
