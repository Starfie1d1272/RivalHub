export type FreePredictionKind = "result" | "bp";
export interface FreePredictionSubject {
  entryIds: [string, string]; runId: string; format: "bo1" | "bo3" | "bo5"; mapPool: string[];
}
export interface FreePredictionResultDTO {
  state: "pending" | "void" | "correct" | "incorrect";
  hits: number | null; total: number; answer: string[] | null;
}
export interface FreePredictionMatchDTO {
  matchId: string; a: string; b: string; logoA: string | null; logoB: string | null; stage: string; scheduledAt: string | null; entryIds: [string, string]; format: "bo1" | "bo3" | "bo5"; mapPool: string[];
  result: { locked: boolean; canSubmit: boolean; mine: string | null; grade: FreePredictionResultDTO | null;
    support: { total: number; counts: [number, number]; percentages: [number, number] | null } };
  bp: { locked: boolean; canSubmit: boolean; mine: string[] | null; grade: FreePredictionResultDTO | null;
    support: { total: number; maps: { name: string; count: number }[] } };
}
export type FreePredictionSort = "profit" | "hits" | "accuracy";
export interface FreePredictionRankingRowDTO {
  userId: string; playerUserId: string | null; name: string; profit: string | null;
  hits: number | null; judged: number | null; accuracy: number | null;
  rank: number | null; group: "ranked" | "limited";
}
