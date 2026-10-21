import "server-only";
import type { TxDb } from "@/db/client";
import { readFreePredictionBoard } from "@/lib/free-predictions/data";
import type { BetPublicStats } from "./public-stats-read";
import { betBoard } from "./data";
import { loadBetFacts } from "./facts";

export interface UnifiedBoardScope { view?: string; matchId?: string; recordsPage?: number }
/** Fresh viewer/fact snapshot; optional shared aggregates contain no viewer data. */
export async function readUnifiedBetBoard(tx: TxDb, seasonId: string, userId: string | null, scope: UnifiedBoardScope = {}, publicStats?: BetPublicStats) {
  const includeEvent = !scope.matchId && ["event", "mine", "settled"].includes(scope.view ?? "open");
  const facts = await loadBetFacts(tx,seasonId,{matchId:scope.matchId,event:includeEvent,rosterUserId:includeEvent ? undefined : userId});
  const bet = await betBoard(tx,seasonId,userId,{facts,matchId:scope.matchId,includeEvent,publicPools:publicStats?.pools,leaderboard:false,
    records:scope.view === "records" && scope.recordsPage !== undefined ? {page:scope.recordsPage,size:50} : false});
  const free = ["event","records","leaderboard"].includes(scope.view ?? "open") ? {seasonId,matches:[]}
    : await readFreePredictionBoard(tx,seasonId,userId,{facts,matchId:scope.matchId,publicSupport:publicStats?.free});
  return {bet,free};
}
