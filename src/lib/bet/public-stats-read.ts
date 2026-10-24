import "server-only";
import type { TxDb } from "@/db/client";
import { readBetPools } from "./data";
import { loadBetFacts } from "./facts";
import { loadFreePredictionPopulation, projectFreePredictionSupport } from "@/lib/free-predictions/data";

export interface BetPublicStatsScope { matchId?: string; includeEvent: boolean; includeFree: boolean; view?: "event" }
/** Explicit aggregate projection: no accounts, voter identities, selections or raw facts. */
export async function readBetPublicStatsSnapshot(tx: TxDb, seasonId: string, scope: BetPublicStatsScope) {
  const pools = await readBetPools(tx,seasonId,scope);
  if (!scope.includeFree) return {pools,population:undefined};
  const facts = await loadBetFacts(tx,seasonId,{matchId:scope.matchId,event:false,rosterUserId:null});
  const population = await loadFreePredictionPopulation(tx,seasonId,{facts,matchId:scope.matchId});
  return {pools,population};
}
export function projectBetPublicStats(snapshot: Awaited<ReturnType<typeof readBetPublicStatsSnapshot>>) {
  return {pools:snapshot.pools,free:snapshot.population?projectFreePredictionSupport(snapshot.population):undefined};
}
export async function readBetPublicStats(tx: TxDb, seasonId: string, scope: BetPublicStatsScope) {
  return projectBetPublicStats(await readBetPublicStatsSnapshot(tx,seasonId,scope));
}
export type BetPublicStats = ReturnType<typeof projectBetPublicStats>;
