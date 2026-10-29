import "server-only";
import type { TxDb } from "@/db/client";
import { readBetPools } from "./data";
import { loadBetPublicSupportFacts } from "./facts";
import { loadPublicPredictionPopulation, projectFreePredictionSupport } from "@/lib/free-predictions/data";

export interface BetPublicStatsScope { matchId?: string; includeEvent: boolean; includeFree: boolean; view?: "event" }
/** Explicit aggregate projection: no accounts, voter identities, selections or raw facts. */
export async function readBetPublicStatsSnapshot(tx: TxDb, seasonId: string, scope: BetPublicStatsScope) {
  const pools = await readBetPools(tx,seasonId,scope);
  if (!scope.includeFree) return {pools,population:undefined};
  const facts = await loadBetPublicSupportFacts(tx,seasonId,scope.matchId);
  const population = await loadPublicPredictionPopulation(tx,seasonId,facts,scope.matchId);
  return {pools,population};
}
export function projectBetPublicStats(snapshot: Awaited<ReturnType<typeof readBetPublicStatsSnapshot>>) {
  return {pools:snapshot.pools,free:snapshot.population?projectFreePredictionSupport(snapshot.population):undefined};
}
export async function readBetPublicStats(tx: TxDb, seasonId: string, scope: BetPublicStatsScope) {
  return projectBetPublicStats(await readBetPublicStatsSnapshot(tx,seasonId,scope));
}
export type BetPublicStats = ReturnType<typeof projectBetPublicStats>;
