import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { users, steamProfiles } from "@/db/schema";
import { readBetAccounts } from "@/lib/bet/account-data";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getPublicPlayerIdentityIds } from "@/lib/players/public-identity";
import { partitionRankingPopulation } from "@/lib/stats/ranking";
import { loadFreePredictionPopulation, choiceFact } from "./data";
import { gradePrediction } from "./domain";
import type { FreePredictionRankingRowDTO, FreePredictionSort } from "./types";
export async function readFreeRankingSnapshot(tx: TxDb, seasonId: string) {
  const {facts,rows} = await loadFreePredictionPopulation(tx,seasonId);
  const finances=await readBetAccounts(tx,seasonId,undefined,facts,{records:false});
  const financial=finances.leaderboard;
  // Includes joined but unjudged accounts and retains complete-population ranks.
  const accounts=finances.financialPopulation;
  const ids = [...new Set([...rows.map(r=>r.userId),...accounts.map(r=>r.userId)])];
  const identities = ids.length ? await tx.select({userId:users.id,displayName:users.displayName,perfectName:users.perfectName,personaName:steamProfiles.personaName})
    .from(users).leftJoin(steamProfiles,eq(steamProfiles.steam64,users.steam64)).where(inArray(users.id,ids)) : [];
  const playerIds = await getPublicPlayerIdentityIds(tx,ids);
  return {facts,rows,financial,accounts,identities,playerIds,finances};
}
function projectPopulation(snapshot: Awaited<ReturnType<typeof readFreeRankingSnapshot>>) {
  const {facts,rows,financial,accounts,identities,playerIds}=snapshot;
  const results = new Map<string,{hits:number;judged:number}>();
  for (const row of rows.filter(r=>r.kind === "result")) {
    const grade = gradePrediction("result",row.selection,choiceFact(row,facts));
    if (grade.state !== "correct" && grade.state !== "incorrect") continue;
    const current = results.get(row.userId) ?? {hits:0,judged:0};
    current.judged++; current.hits += grade.hits!; results.set(row.userId,current);
  }
  const population: FreePredictionRankingRowDTO[] = identities.map(identity=>{
    const score = results.get(identity.userId); const bet = accounts.find(r=>r.userId===identity.userId);
    return {userId:identity.userId,playerUserId:playerIds.has(identity.userId)?identity.userId:null,name:getPublicDisplayName(identity),profit:bet?.profit??null,
      hits:score?.hits??null,judged:score?.judged??null,accuracy:score?score.hits/score.judged:null,rank:null,group:"limited"};
  });
  return { population, financial };
}

/** Baseline is the entire event. Filters are applied only after ranks/eligibility. */
export async function readFreePredictionRanking(tx: TxDb, seasonId: string, sort: FreePredictionSort, filterUserIds?: string[]) {
  return projectRanking(projectPopulation(await readFreeRankingSnapshot(tx, seasonId)), sort, filterUserIds);
}

/** All three views share one read-only snapshot and one population. */
export async function readFreePredictionRankings(tx: TxDb, seasonId: string) {
  return projectFreeRankings(await readFreeRankingSnapshot(tx,seasonId));
}
export function projectFreeRankings(snapshot: Awaited<ReturnType<typeof readFreeRankingSnapshot>>) {
  const population=projectPopulation(snapshot);
  return {profit:projectRanking(population,"profit"),hits:projectRanking(population,"hits"),accuracy:projectRanking(population,"accuracy")};
}

function projectRanking(input: ReturnType<typeof projectPopulation>, sort: FreePredictionSort, filterUserIds?: string[]) {
  // Each ranking assigns group/rank independently; never mutate the shared population.
  const population = input.population.map(row => ({ ...row }));
  const financial = input.financial;
  const accuracyPopulation = partitionRankingPopulation(population,row=>row.accuracy,row=>row.judged,population);
  // Hit totals need participation, not the accuracy leaderboard's sample floor.
  const ranked = sort === "hits" ? population.filter(row=>(row.judged??0)>=1) : accuracyPopulation.ranked;
  const limited = sort === "hits" ? population.filter(row=>(row.judged??0)<1) : accuracyPopulation.limited;
  const dynamicFloor = sort === "hits" ? (ranked.length ? {floor:1,reference:1,quantile:1,share:1} : null) : accuracyPopulation.dynamicFloor;
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
