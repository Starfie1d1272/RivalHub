import type { MajorStrengthFact, MajorStrengthRecommendationTeam, MajorStrengthStarter, MajorStrengthTeam } from "./types";

export type ProjectableStrengthFact = {
  rank: string;
  stars?: number | null;
  sourcePlatform?: string | null;
  sourceSeasonKey?: string | null;
  sourceRank?: string | null;
  sourceStars?: number | null;
  conversionVersion?: string | null;
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
    rank: fact.rank,
    stars: fact.stars ?? null,
    sourcePlatform: fact.sourcePlatform ?? null,
    sourceSeasonKey: fact.sourceSeasonKey ?? null,
    sourceRank: fact.sourceRank ?? null,
    sourceStars: fact.sourceStars ?? null,
    conversionVersion: fact.conversionVersion ?? null,
  } : null;
}

export function projectStrengthStarter(starter: StrengthStarterProjection): MajorStrengthStarter {
  return {
    userId: starter.userId,
    label: starter.label,
    historicalPeak: projectStrengthFact(starter.input.historicalPeak),
    previousSeasonPeak: projectStrengthFact(starter.input.previousSeasonPeak),
    currentSeasonPeak: projectStrengthFact(starter.input.currentSeasonPeak),
    recentSeasonPeaks: (starter.input.recentSeasonPeaks ?? []).map(projectStrengthFact),
    effectiveRecentPeak: projectStrengthFact(starter.breakdown.effectiveRecentPeak),
    breakdown: {
      available: starter.breakdown.available ?? true,
      blockers: [...(starter.breakdown.blockers ?? [])],
      weightedRank: starter.breakdown.weightedRank,
      historicalValue: starter.breakdown.historicalValue,
      previousValue: starter.breakdown.previousValue,
      currentValue: starter.breakdown.currentValue,
      effectiveRecentPeak: projectStrengthFact(starter.breakdown.effectiveRecentPeak),
      historicalRating: starter.breakdown.historicalRating,
    },
  };
}

type CompleteStrengthTeamProjection = StrengthTeamProjection & {
  teamSeedStrength: number;
  teamSeedStrengthScaled: number;
  recommendationRank: number;
  tieGroup: number;
  displayOrder: number;
};

export function projectStrengthTeam(team: CompleteStrengthTeamProjection): MajorStrengthRecommendationTeam;
export function projectStrengthTeam(team: StrengthTeamProjection): MajorStrengthTeam;
export function projectStrengthTeam(team: StrengthTeamProjection): MajorStrengthTeam {
  return {
    teamId: team.teamId,
    teamName: team.teamName,
    available: team.available,
    blockers: [...team.blockers],
    teamSeedStrength: team.teamSeedStrength,
    teamSeedStrengthScaled: team.teamSeedStrengthScaled,
    recommendationRank: team.recommendationRank,
    tieGroup: team.tieGroup,
    displayOrder: team.displayOrder,
    starters: team.starters.map(projectStrengthStarter),
  };
}
