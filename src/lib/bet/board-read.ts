import "server-only";
import { z } from "zod";
import type { TxDb } from "@/db/client";
import { readFreePredictionSnapshot, projectFreePredictionBoard } from "@/lib/free-predictions/data";
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
export async function readUnifiedBetSnapshot(tx: TxDb, seasonId: string, userId: string | null, scope: UnifiedBoardScope = {}, publicStats?: BetPublicStats, shared?:{facts:BetFacts;financialPopulation:BetAccountReadOptions["financialPopulation"]}) {
  const includeEvent = !scope.matchId && ["event", "mine", "settled"].includes(scope.view ?? "open");
  const facts = shared?.facts ?? await loadBetFacts(tx,seasonId,{matchId:scope.matchId,event:includeEvent,rosterUserId:includeEvent ? undefined : userId,headerOnly:["records","leaderboard"].includes(scope.view??"")});
  const bet = await readBetBoardSnapshot(tx,seasonId,userId,{facts,financialPopulation:shared?.financialPopulation,view:scope.view,matchId:scope.matchId,includeEvent,publicPools:publicStats?.pools,leaderboard:false,
    records:scope.view === "records" && scope.recordsPage !== undefined ? {page:scope.recordsPage,size:50,cursor:parseBetRecordsCursor(scope.recordsCursor)} : false});
  const free = ["event","records","leaderboard"].includes(scope.view ?? "open") ? null
    : await readFreePredictionSnapshot(tx,seasonId,userId,{facts,matchId:scope.matchId,publicSupport:publicStats?.free});
  return {bet,free};
}

export function projectUnifiedBetBoard(snapshot: Awaited<ReturnType<typeof readUnifiedBetSnapshot>>) {
  return {bet:projectBetBoard(snapshot.bet),free:snapshot.free ? projectFreePredictionBoard(snapshot.free) : {seasonId:snapshot.bet.seasonId,matches:[]}};
}
export async function readUnifiedBetBoard(tx: TxDb, seasonId: string, userId: string | null, scope: UnifiedBoardScope = {}, publicStats?: BetPublicStats) {
  return projectUnifiedBetBoard(await readUnifiedBetSnapshot(tx,seasonId,userId,scope,publicStats));
}
