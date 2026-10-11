import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { users, steamProfiles, betAccounts, betLedger } from "@/db/schema";
import { readBetAccounts } from "@/lib/bet/account-data";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getPublicPlayerIdentityIds } from "@/lib/players/public-identity";
import { partitionRankingPopulation } from "@/lib/stats/ranking";
import { loadFreePredictionPopulation, choiceFact } from "./data";
import { gradePrediction } from "./domain";
import type { FreePredictionRankingRowDTO, FreePredictionSort } from "./types";
/** Baseline is the entire event. Filters are applied only after ranks/eligibility. */
export async function readFreePredictionRanking(tx: TxDb, seasonId: string, sort: FreePredictionSort, filterUserIds?: string[]) {
  const {facts,rows} = await loadFreePredictionPopulation(tx,seasonId);
  const financial = (await readBetAccounts(tx,seasonId,undefined,facts)).leaderboard;
  // Canonical account totals keep joined-but-unjudged participants distinct from absence.
  const accounts = await tx.select({userId:betAccounts.userId,profit:sql<string>`coalesce(sum(${betLedger.profit}),0)::text`})
    .from(betAccounts).leftJoin(betLedger,eq(betLedger.accountId,betAccounts.id)).where(eq(betAccounts.seasonId,seasonId)).groupBy(betAccounts.userId);
  const results = new Map<string,{hits:number;judged:number}>();
  for (const row of rows.filter(r=>r.kind === "result")) {
    const grade = gradePrediction("result",row.selection,choiceFact(row,facts));
    if (grade.state !== "correct" && grade.state !== "incorrect") continue;
    const current = results.get(row.userId) ?? {hits:0,judged:0};
    current.judged++; current.hits += grade.hits!; results.set(row.userId,current);
  }
  const ids = [...new Set([...rows.map(r=>r.userId),...accounts.map(r=>r.userId)])];
  const identities = ids.length ? await tx.select({userId:users.id,displayName:users.displayName,perfectName:users.perfectName,personaName:steamProfiles.personaName})
    .from(users).leftJoin(steamProfiles,eq(steamProfiles.steam64,users.steam64)).where(inArray(users.id,ids)) : [];
  const playerIds = await getPublicPlayerIdentityIds(tx,ids);
  const population: FreePredictionRankingRowDTO[] = identities.map(identity=>{
    const score = results.get(identity.userId); const bet = accounts.find(r=>r.userId===identity.userId);
    return {userId:identity.userId,playerUserId:playerIds.has(identity.userId)?identity.userId:null,name:getPublicDisplayName(identity),profit:bet?.profit??null,
      hits:score?.hits??null,judged:score?.judged??null,accuracy:score?score.hits/score.judged:null,rank:null,group:"limited"};
  });
  const {dynamicFloor,ranked,limited} = partitionRankingPopulation(population,row=>row.accuracy,row=>row.judged,population);
  const eligible = sort === "profit" ? financial.map(b=>population.find(r=>r.userId===b.userId)!) : ranked;
  const rest = sort === "profit" ? population.filter(r=>!financial.some(b=>b.userId===r.userId)) : limited;
  const metricCompare = (a:FreePredictionRankingRowDTO,b:FreePredictionRankingRowDTO) => {
    if (sort === "profit") {const left=BigInt(a.profit??"0"),right=BigInt(b.profit??"0");return left===right?0:left>right?-1:1;}
    return sort === "hits" ? (b.hits??-1)-(a.hits??-1) : (b.accuracy??-1)-(a.accuracy??-1);
  };
  const stableCompare = (a:FreePredictionRankingRowDTO,b:FreePredictionRankingRowDTO) => metricCompare(a,b)||(b.judged??0)-(a.judged??0)||a.userId.localeCompare(b.userId);
  if(sort !== "profit") eligible.sort(stableCompare); rest.sort(stableCompare);
  let rank = 0;
  eligible.forEach((row,i)=>{if (!i || metricCompare(row,eligible[i-1]!)!==0) rank=i+1;row.rank=rank;row.group="ranked";});
  // Preserve the BET owner's existing qualification/tie ranks for profit order.
  if(sort === "profit") eligible.forEach(row=>{row.rank=financial.find(r=>r.userId===row.userId)!.rank;});
  const ordered = [...eligible,...rest];
  return {sort,dynamicFloor,rows:filterUserIds?ordered.filter(r=>filterUserIds.includes(r.userId)):ordered};
}
