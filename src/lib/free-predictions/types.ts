import type { DisplayScore } from "@/lib/matches/display-score";
export type FreePredictionKind = "result" | "bp";
export interface FreePredictionSubject {
  entryIds: [string, string]; runId: string; format: "bo1" | "bo3" | "bo5"; mapPool: string[];
}
export interface FreePredictionResultDTO {
  state: "pending" | "void" | "correct" | "incorrect";
  hits: number | null; total: number; answer: string[] | null;
}
export interface FreePredictionRestrictionDTO {
  code: "cancelled" | "forfeit" | "finished" | "season_closed" | "sign_in" | "account_inactive" | "verify_email" | "invalid_map_pool" | "started";
  message: string;
}
export interface FreePredictionMatchDTO {
  displayScore?: DisplayScore;
  matchId: string; status: "scheduled" | "in_progress" | "finished" | "cancelled"; isForfeit: boolean; a: string; b: string; logoA: string | null; logoB: string | null; stage: string; scheduledAt: string | null; entryIds: [string, string]; format: "bo1" | "bo3" | "bo5"; mapPool: string[];
  result: { locked: boolean; canSubmit: boolean; restriction: FreePredictionRestrictionDTO | null; mine: string | null; grade: FreePredictionResultDTO | null;
    support: { total: number; counts: [number, number]; percentages: [number, number] | null } };
  bp: { locked: boolean; canSubmit: boolean; restriction: FreePredictionRestrictionDTO | null; mine: string[] | null; grade: FreePredictionResultDTO | null;
    support: { total: number; maps: { name: string; count: number }[] } };
}
export type FreePredictionSort = "profit" | "hits" | "accuracy";
export interface FreePredictionRankingRowDTO {
  userId: string; playerUserId: string | null; name: string; profit: string | null;
  hits: number | null; judged: number | null; accuracy: number | null;
  rank: number | null; group: "ranked" | "limited";
}
