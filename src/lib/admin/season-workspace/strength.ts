import { compositeDisplayRank } from "@/lib/major/composite-rank";
import type { MajorStrengthFact, MajorStrengthStarter, MajorStrengthTeam, MajorStrengthTieState } from "./types";

export type ProjectableStrengthFact = {
  rating?: number | null;
  rank: string;
  stars?: number | null;
  sourcePlatform?: string | null;
  sourceSeasonKey?: string | null;
  sourceRank?: string | null;
  sourceStars?: number | null;
  conversionVersion?: string | null;
  estimatedFromUnranked?: boolean;
  estimatedFromSeasonKey?: string | null;
  estimatedFromHistorical?: boolean;
};

type StrengthStarterProjection = {
  userId: string;
  label: string;
  input: {
    historicalPeak: ProjectableStrengthFact | null;
    previousSeasonPeak: ProjectableStrengthFact | null;
    currentSeasonPeak: ProjectableStrengthFact | null;
    recentSeasonPeaks?: Array<ProjectableStrengthFact | null>;
  };
  breakdown: {
    available?: boolean;
    blockers?: readonly string[];
    weightedRank: number | null;
    historicalValue: number | null;
    previousValue: number | null;
    currentValue: number | null;
    effectiveRecentPeak: ProjectableStrengthFact | null;
    historicalRating: number | null;
  };
};

type StrengthTeamProjection = {
  teamId: string;
  teamName: string;
  available: boolean;
  blockers: readonly string[];
  teamSeedStrength: number | null;
  teamSeedStrengthScaled: number | null;
  recommendationRank: number | null;
  tieGroup: number | null;
  displayOrder: number | null;
  starters: readonly StrengthStarterProjection[];
};

export function projectStrengthFact(fact: ProjectableStrengthFact | null): MajorStrengthFact | null {
  return fact ? {
    rating: fact.rating ?? null,
    rank: fact.rank,
    stars: fact.stars ?? null,
    sourcePlatform: fact.sourcePlatform ?? null,
    sourceSeasonKey: fact.sourceSeasonKey ?? null,
    sourceRank: fact.sourceRank ?? null,
    sourceStars: fact.sourceStars ?? null,
    conversionVersion: fact.conversionVersion ?? null,
    estimatedFromUnranked: fact.estimatedFromUnranked ?? false,
    estimatedFromSeasonKey: fact.estimatedFromSeasonKey ?? null,
    estimatedFromHistorical: fact.estimatedFromHistorical ?? false,
  } : null;
}

export function projectStrengthStarter(starter: StrengthStarterProjection): MajorStrengthStarter {
  const historicalPeak = projectStrengthFact(starter.input.historicalPeak);
  const referenceSeasonPeak = projectStrengthFact(starter.input.previousSeasonPeak);
  const currentSeasonPeak = projectStrengthFact(starter.input.currentSeasonPeak);
  const recentPeak = projectStrengthFact(starter.breakdown.effectiveRecentPeak)
    ?? currentSeasonPeak;
  return {
    userId: starter.userId,
    label: starter.label,
    presentation: {
      compositeRank: compositeDisplayRank(starter.breakdown.weightedRank),
      historicalPeak,
      referenceSeasonPeak,
      currentSeasonPeak,
      recentPeak,
      historicalRating: starter.breakdown.historicalRating,
      available: starter.breakdown.available ?? true,
      blockers: [...(starter.breakdown.blockers ?? [])],
    },
  };
}

function projectTieState(team: StrengthTeamProjection, tieGroupSize: number): MajorStrengthTieState {
  if (team.recommendationRank === null || team.tieGroup === null) return "not_ranked";
  return tieGroupSize > 1 ? "tied" : "not_tied";
}

export function projectStrengthTeams(teams: readonly StrengthTeamProjection[], compositeAxis = true): MajorStrengthTeam[] {
  const tieGroupSizes = new Map<number, number>();
  for (const team of teams) {
    if (team.tieGroup !== null) tieGroupSizes.set(team.tieGroup, (tieGroupSizes.get(team.tieGroup) ?? 0) + 1);
  }

  return teams.map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    available: team.available,
    blockers: [...team.blockers],
    recommendationRank: team.recommendationRank,
    displayOrder: team.displayOrder,
    tieState: projectTieState(team, team.tieGroup === null ? 0 : tieGroupSizes.get(team.tieGroup) ?? 0),
    starters: team.starters.map(starter => {
      const projected = projectStrengthStarter(starter);
      if (!compositeAxis) projected.presentation.compositeRank = null;
      return projected;
    }),
  }));
}
