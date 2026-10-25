import "server-only";
import { z } from "zod";
import type { TxDb } from "@/db/client";
import { readFreePredictionSnapshot, projectFreePredictionBoard, freePredictionSupportSignature } from "@/lib/free-predictions/data";
import type { BetPublicStats } from "./public-stats-read";
import { readBetBoardSnapshot, projectBetBoard } from "./data";
import type { BetAccountReadOptions } from "./account-data";
import { loadBetFacts, type BetFacts } from "./facts";

export interface UnifiedBoardScope { view?: string; matchId?: string; recordsPage?: number; recordsCursor?: string }
/** Fresh viewer/fact snapshot; optional shared aggregates contain no viewer data. */
export function parseBetRecordsCursor(value: string | undefined) {
  if(!value || value.length>256)return undefined;
  try {return z.object({at:z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/),id:z.guid()}).strict().parse(JSON.parse(Buffer.from(value,"base64url").toString("utf8")));}
  catch{return undefined;}
}
export async function readUnifiedBetSnapshot(tx: TxDb, seasonId: string, userId: string | null, scope: UnifiedBoardScope = {}, publicStats?: BetPublicStats | "deferred", shared?:{facts:BetFacts;financialPopulation:BetAccountReadOptions["financialPopulation"]}) {
  const includeEvent = !scope.matchId && ["event", "mine", "settled"].includes(scope.view ?? "open");
  const facts = shared?.facts ?? await loadBetFacts(tx,seasonId,{matchId:scope.matchId,event:includeEvent,rosterUserId:includeEvent ? undefined : userId,headerOnly:["records","leaderboard"].includes(scope.view??"")});
  // A deferred aggregate is display-only. Its matching signature lets the free
  // reader load canonical viewer choices without waiting for the public cache.
  const aggregates = publicStats === "deferred" ? {
    pools:{pool:[],counts:[]},
    free:{signature:freePredictionSupportSignature(facts),matches:[]},
  } : publicStats;
  const bet = await readBetBoardSnapshot(tx,seasonId,userId,{facts,financialPopulation:shared?.financialPopulation,view:scope.view,matchId:scope.matchId,includeEvent,publicPools:aggregates?.pools,leaderboard:false,
    records:scope.view === "records" && scope.recordsPage !== undefined ? {page:scope.recordsPage,size:50,cursor:parseBetRecordsCursor(scope.recordsCursor)} : false});
  const free = ["event","records","leaderboard"].includes(scope.view ?? "open") ? null
    : await readFreePredictionSnapshot(tx,seasonId,userId,{facts,matchId:scope.matchId,publicSupport:aggregates?.free});
  return {bet,free,publicStatsPending:publicStats === "deferred"};
}

export function projectUnifiedBetBoard(snapshot: Awaited<ReturnType<typeof readUnifiedBetSnapshot>>) {
  if (snapshot.publicStatsPending) throw new Error("BET public projection is not ready");
  return {bet:projectBetBoard(snapshot.bet),free:snapshot.free ? projectFreePredictionBoard(snapshot.free) : {seasonId:snapshot.bet.seasonId,matches:[]}};
}
export async function readUnifiedBetBoard(tx: TxDb, seasonId: string, userId: string | null, scope: UnifiedBoardScope = {}, publicStats?: BetPublicStats) {
  return projectUnifiedBetBoard(await readUnifiedBetSnapshot(tx,seasonId,userId,scope,publicStats));
}

/** Attach only display aggregates; money, admission and clocks stay private. */
export function completeUnifiedBetSnapshot(snapshot: Awaited<ReturnType<typeof readUnifiedBetSnapshot>>, stats: BetPublicStats | undefined) {
  if (!stats || (snapshot.free && stats.free?.signature !== freePredictionSupportSignature(snapshot.free.f))) return undefined;
  return {...snapshot,publicStatsPending:false,
    bet:{...snapshot.bet,pool:stats.pools.pool,counts:stats.pools.counts},
    free:snapshot.free ? {...snapshot.free,support:stats.free} : null};
}
