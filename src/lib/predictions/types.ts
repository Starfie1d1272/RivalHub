/** Explicit public contracts. Never expose a MajorRunSnapshot to the browser. */
export const SIMULATION_VERSION = 1;
export type Pick =
  | { perfect: string[]; advance: string[]; eliminated: string[] }
  | { bracket: string[] };
export interface PredictionRules {
  perfect: number;
  advance: number;
  eliminated: number;
  swissTarget: number;
  silver: number;
  gold: number;
  diamond: number;
  initialPoints: number;
  stagePoints: number;
  participationPoints: number;
  cutoffMinutes: number;
}
export interface PublicStage {
  key: string;
  name: string;
  type: "swiss" | "single_elim";
  matchFormat: "bo1" | "bo3";
  entrySeeds: number;
  finalFormat: "bo5" | null;
}
interface PublicMatch {
  id: string;
  stageKey: string;
  key: string;
  round: number;
  a: string;
  b: string;
  winner: string | null;
  format: "bo1" | "bo3" | "bo5";
  status: "scheduled" | "in_progress" | "finished" | "cancelled";
  scheduledAt: string | null;
}
export interface Baseline {
  version: number;
  seasonId: string;
  name: string;
  capturedAt: string;
  revision?: string;
  stages: PublicStage[];
  teams: {
    teamId: string;
    name: string;
    logoUrl: string | null;
    tournamentSeed: number;
  }[];
  runs: {
    key: string;
    entrants: { teamId: string; seed: number }[];
    finalizedRound: number;
  }[];
  matches: PublicMatch[];
}
interface Choice {
  a: string;
  b: string;
  winner: string;
}
export type Choices = Record<string, Choice>;
export interface SimMatch {
  key: string;
  round: number;
  a: string;
  b: string;
  winner: string | null;
  source: "official" | "assumption" | "pending";
  format: string;
}
export interface SimStage {
  key: string;
  entrants: { teamId: string; seed: number }[];
  officialEntrants: boolean;
  matches: SimMatch[];
  complete: boolean;
  standings: { teamId: string; wins: number; losses: number }[];
  pick: Pick | null;
}
/** JSONB object key order is not semantic; preserve slot array order. */
export function samePick(a: Pick, b: Pick): boolean {
  if ("bracket" in a && "bracket" in b)
    return JSON.stringify(a.bracket) === JSON.stringify(b.bracket);
  if ("perfect" in a && "perfect" in b)
    return (["perfect", "advance", "eliminated"] as const).every(
      (k) => JSON.stringify(a[k]) === JSON.stringify(b[k]),
    );
  return false;
}
