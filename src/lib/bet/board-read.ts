import "server-only";
import type { TxDb } from "@/db/client";
import { readFreePredictionBoard } from "@/lib/free-predictions/data";
import { betBoard } from "./data";
import { loadBetFacts } from "./facts";

export interface UnifiedBoardScope { view?: string; matchId?: string; recordsPage?: number }
/** One request/transaction owns the shared facts; no cross-request cache. */
export async function readUnifiedBetBoard(tx: TxDb, seasonId: string, userId: string | null, scope: UnifiedBoardScope = {}) {
  const includeEvent = !scope.matchId && ["event", "mine", "settled"].includes(scope.view ?? "open");
  const facts = await loadBetFacts(tx,seasonId,{matchId:scope.matchId,event:includeEvent,rosterUserId:includeEvent ? undefined : userId});
  const bet = await betBoard(tx,seasonId,userId,{facts,matchId:scope.matchId,includeEvent,leaderboard:false,
    records:scope.view === "records" && scope.recordsPage !== undefined ? {page:scope.recordsPage,size:50} : false});
  const free = ["event","records","leaderboard"].includes(scope.view ?? "open") ? {seasonId,matches:[]}
    : await readFreePredictionBoard(tx,seasonId,userId,{facts,matchId:scope.matchId});
  return {bet,free};
}
