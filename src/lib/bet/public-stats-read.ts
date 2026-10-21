import "server-only";
import type { TxDb } from "@/db/client";
import { readBetPools } from "./data";
import { loadBetFacts } from "./facts";
import { freePredictionSupportSignature, readFreePredictionBoard } from "@/lib/free-predictions/data";

export interface BetPublicStatsScope { matchId?: string; includeEvent: boolean; includeFree: boolean }
/** Explicit aggregate projection: no accounts, voter identities, selections or raw facts. */
export async function readBetPublicStats(tx: TxDb, seasonId: string, scope: BetPublicStatsScope) {
  const pools = await readBetPools(tx,seasonId,scope);
  if (!scope.includeFree) return {pools,free:undefined};
  const facts = await loadBetFacts(tx,seasonId,{matchId:scope.matchId,event:false,rosterUserId:null});
  const board = await readFreePredictionBoard(tx,seasonId,null,{facts,matchId:scope.matchId});
  return {pools,free:{signature:freePredictionSupportSignature(facts),matches:board.matches.map(m=>({matchId:m.matchId,result:m.result.support,bp:m.bp.support}))}};
}
export type BetPublicStats = Awaited<ReturnType<typeof readBetPublicStats>>;
