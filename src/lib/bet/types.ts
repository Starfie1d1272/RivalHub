export const MARKET_TYPES = ["champion", "top_fragger", "match_winner", "exact_score", "total_maps", "veto_map", "veto_first", "veto_decider", "map_winner", "total_rounds"] as const;
export type MarketType = typeof MARKET_TYPES[number];
export type BetSubject =
  | { kind: "event"; entryIds: string[]; playerIds: string[] }
  | { kind: "match"; entryIds: [string, string]; runId: string; format: "bo1" | "bo3" | "bo5"; mapPool: string[] }
  | { kind: "map"; entryIds: [string, string]; runId: string; format: "bo1" | "bo3" | "bo5"; mapId: string; mapOrder: number; mapName: string };
export type BetState = "open" | "locked" | "settled" | "refunded";
export interface BetMarketDTO {
  id: string; matchId: string | null; type: MarketType; title: string; help: string; group: "赛事" | "比赛" | "BP" | "单图";
  context: string; state: BetState; pool: string; participants: number; canStake: boolean; restriction: string | null;
  options: { id: string; label: string; pool: string; percent: number; winner: boolean }[];
  mine: { optionId: string; amount: string; payout: string | null; profit: string | null } | null;
}
export interface BetBoardDTO {
  seasonId: string; enabled: boolean; paused: boolean; joined: boolean;
  balance: string; debt: string; profit: string; rank: number | null;
  leaderboard: { userId: string; name: string; profit: string; settledCount: number; rank: number }[];
  records: { createdAt: string; amount: string; label: string; context: string | null }[];
  markets: BetMarketDTO[];
  matches: { id: string; a: string; b: string; logoA: string | null; logoB: string | null; stage: string; format: string; scheduledAt: string | null }[];
}
