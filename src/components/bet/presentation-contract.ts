import type { ActionResult } from "@/types/action";

/** Presentation inputs only. Canonical owners provide permissions and judgement. */
export interface FreePredictionModel {
  matchId: string;
  kind: "winner" | "bp";
  requiredChoices: number;
  options: { key: string; label: string; count: number | null }[];
  own: string[];
  participants: number;
  canSubmit: boolean;
  status: "open" | "locked" | "judged" | "void" | "unavailable";
  reason: string | null;
  result: { hit: boolean; matched: number; total: number } | null;
}

export interface FreePredictionControls {
  submitAction: (model: FreePredictionModel, keys: string[]) => Promise<ActionResult<FreePredictionModel>>;
  refreshAction: (model: FreePredictionModel) => Promise<ActionResult<FreePredictionModel>>;
}

export type PredictionRankingSort = "profit" | "hits" | "accuracy";
export interface PredictionRankingRow {
  userId: string;
  playerUserId: string | null;
  name: string;
  profit: string | null;
  hits: number | null;
  decided: number | null;
  rank: number | null;
}
export interface PredictionRankingModel {
  rows: PredictionRankingRow[];
  rankedCount: number;
  floor: number | null;
}

export interface BetReliefModel {
  canClaim: boolean;
  amount: string;
  status: "eligible" | "claimed_today" | "exhausted" | "unavailable";
  reason: string | null;
}
