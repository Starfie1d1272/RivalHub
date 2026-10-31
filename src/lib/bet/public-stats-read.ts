import "server-only";
import type { TxDb } from "@/db/client";
import { readBetPools } from "./data";
import { loadBetPublicSupportFacts } from "./facts";
import { readPublicPredictionSupport } from "@/lib/free-predictions/data";

export interface BetPublicStatsScope { matchId?: string; includeEvent: boolean; includeFree: boolean; view?: "event" }
/** Explicit aggregate projection: no accounts, voter identities, selections or raw facts. */
export async function readBetPublicStatsSnapshot(tx: TxDb, seasonId: string, scope: BetPublicStatsScope) {
  const pools = await readBetPools(tx,seasonId,scope);
  if (!scope.includeFree) return {pools,free:undefined};
  const facts = await loadBetPublicSupportFacts(tx,seasonId,scope.matchId);
  const free = await readPublicPredictionSupport(tx,seasonId,facts,scope.matchId);
  return {pools,free};
}
export function projectBetPublicStats(snapshot: Awaited<ReturnType<typeof readBetPublicStatsSnapshot>>) {
  return {pools:snapshot.pools,free:snapshot.free};
}
export async function readBetPublicStats(tx: TxDb, seasonId: string, scope: BetPublicStatsScope) {
  return projectBetPublicStats(await readBetPublicStatsSnapshot(tx,seasonId,scope));
}
export type BetPublicStats = ReturnType<typeof projectBetPublicStats>;
