export interface SwissConfig {
  winThreshold: number;
  lossThreshold: number;
}

export interface SwissRecord {
  wins: number;
  losses: number;
}

export interface SwissEntrant {
  teamId: string;
  initialSeed: number;
}

export interface SwissCompletedMatch {
  matchId: string;
  round: number;
  entryAId: string;
  entryBId: string;
  winnerId: string;
}

export type SwissStatus = "active" | "advanced" | "eliminated";

export interface SwissTeamState {
  teamId: string;
  initialSeed: number;
  currentSeed: number;
  wins: number;
  losses: number;
  buchholz: number;
  status: SwissStatus;
  opponents: readonly string[];
}

export interface SwissProjection {
  completedRound: number;
  teams: readonly SwissTeamState[];
  active: readonly SwissTeamState[];
  advanced: readonly SwissTeamState[];
  eliminated: readonly SwissTeamState[];
  isComplete: boolean;
}

export interface SwissPair {
  higherSeedTeamId: string;
  lowerSeedTeamId: string;
  higherSeed: number;
  lowerSeed: number;
}
