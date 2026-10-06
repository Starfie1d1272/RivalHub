import "server-only";
import { and, eq, asc, desc, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { betPrograms, betAccounts, betMarkets, betOptions, betStakes, betSettlements, betLedger, seasonAdminGrants, users } from "@/db/schema";
import { loadBetFacts } from "./facts";
import { betFactInput } from "./service";
import { marketIsLocked, resolveBetFact } from "./domain";
import { marketPresentation } from "./presentation";
import type { BetBoardDTO, BetState } from "./types";
/** Read-only repeatable-read snapshot. Never create markets or settle from GET. */
export async function betBoard(tx:TxDb,seasonId:string,userId:string|null):Promise<BetBoardDTO> {
  const program=await tx.query.betPrograms.findFirst({where:eq(betPrograms.seasonId,seasonId)});
  if (!program) return {seasonId,enabled:false,paused:false,joined:false,balance:"0",debt:"0",profit:"0",rank:null,markets:[],matches:[]};
  const f=await loadBetFacts(tx,seasonId);
  const account=userId?await tx.query.betAccounts.findFirst({where:and(eq(betAccounts.seasonId,seasonId),eq(betAccounts.userId,userId))}):undefined;
  const user=userId?await tx.query.users.findFirst({where:eq(users.id,userId),columns:{role:true,status:true,emailVerifiedAt:true}}):undefined;
  const admin=userId?await tx.query.seasonAdminGrants.findFirst({where:and(eq(seasonAdminGrants.seasonId,seasonId),eq(seasonAdminGrants.userId,userId))}):undefined;
  const totals=await tx.select({accountId:betLedger.accountId,balance:sql<string>`sum(${betLedger.amount})::text`,profit:sql<string>`sum(${betLedger.profit})::text`}).from(betLedger).where(eq(betLedger.seasonId,seasonId)).groupBy(betLedger.accountId);
  const mine=totals.find(t=>t.accountId===account?.id); const balance=BigInt(mine?.balance??"0");
  const rank=account?1+totals.filter(t=>BigInt(t.profit)>BigInt(mine?.profit??"0")).length:null;
  const all=await tx.select().from(betMarkets).where(eq(betMarkets.seasonId,seasonId)).orderBy(asc(betMarkets.createdAt));
  const pool=await tx.select({marketId:betStakes.marketId,optionId:betStakes.optionId,amount:sql<string>`sum(${betStakes.amount})::text`}).from(betStakes).where(eq(betStakes.seasonId,seasonId)).groupBy(betStakes.marketId,betStakes.optionId);
  const counts=await tx.select({marketId:betStakes.marketId,count:sql<number>`count(distinct ${betStakes.accountId})::int`}).from(betStakes).where(eq(betStakes.seasonId,seasonId)).groupBy(betStakes.marketId);
  const myStakes=account?await tx.select({marketId:betStakes.marketId,optionId:betStakes.optionId,amount:sql<string>`sum(${betStakes.amount})::text`}).from(betStakes).where(eq(betStakes.accountId,account.id)).groupBy(betStakes.marketId,betStakes.optionId):[];
  const allOptions=await tx.select({option:betOptions}).from(betOptions).innerJoin(betMarkets,eq(betMarkets.id,betOptions.marketId)).where(eq(betMarkets.seasonId,seasonId)).orderBy(asc(betOptions.position)).then(rows=>rows.map(r=>r.option));
  const latestSettlements=await tx.selectDistinctOn([betSettlements.marketId],{batch:betSettlements}).from(betSettlements).innerJoin(betMarkets,eq(betMarkets.id,betSettlements.marketId)).where(eq(betMarkets.seasonId,seasonId)).orderBy(asc(betSettlements.marketId),desc(betSettlements.revision)).then(rows=>rows.map(r=>r.batch));
  const myPayouts=account?await tx.select().from(betLedger).where(and(eq(betLedger.accountId,account.id),eq(betLedger.kind,"settlement"))):[];
  const result:BetBoardDTO={seasonId,enabled:!!program,paused:program?.paused??false,joined:!!account,balance:(balance>BigInt(0)?balance:BigInt(0)).toString(),debt:(balance<BigInt(0)?-balance:BigInt(0)).toString(),profit:mine?.profit??"0",rank,markets:[],matches:f.official.map(m=>({id:m.id,a:f.entries.find(e=>e.id===m.entryAId)?.name??"队伍",b:f.entries.find(e=>e.id===m.entryBId)?.name??"队伍",logoA:f.entries.find(e=>e.id===m.entryAId)?.logoUrl??null,logoB:f.entries.find(e=>e.id===m.entryBId)?.logoUrl??null,stage:m.qualificationRunId?"PLAY-IN":f.season.stagePlan.find(s=>s.key===m.stage)?.name??"正赛",format:m.format.toUpperCase(),scheduledAt:m.scheduledAt?.toISOString()??null}))};
  for(const market of all) {
    const latest=latestSettlements.find(s=>s.marketId===market.id);
    const choices=allOptions.filter(o=>o.marketId===market.id);
    const input=betFactInput(market,f); const current=resolveBetFact(input);
    const state:BetState=latest && latest.state!=="pending"?latest.state:market.lockedAt||marketIsLocked(input)||current.state!=="pending"?"locked":"open";
    const total=pool.filter(p=>p.marketId===market.id).reduce((n,p)=>n+BigInt(p.amount),BigInt(0));
    const invested=myStakes.find(s=>s.marketId===market.id);
    const payout=latest && invested && account && latest.state!=="pending"?myPayouts.find(row=>row.source===`settlement/${latest.id}`):null;
    const restriction=user?.role==="super_admin" || admin?"赛事管理员不能参与盘口":user && (user.status!=="active" || !user.emailVerifiedAt)?"请先完成邮箱验证":f.roster.some(r=>r.userId===userId && market.subject.entryIds.includes(r.entryId))?"相关队伍名单成员不能参与此盘口":null;
    const presentation=marketPresentation(market.type,market.line);
    result.markets.push({id:market.id,matchId:market.matchId,type:market.type,...presentation,context:market.subject.kind==="map"?`图${market.subject.mapOrder} · ${market.subject.mapName.replace(/^de_/,"").replace(/^./,c=>c.toUpperCase())}`:market.subject.kind==="event"?"MAIN EVENT":"",state,pool:total.toString(),participants:counts.find(c=>c.marketId===market.id)?.count??0,canStake:!!account && !!program && !program.paused && state==="open" && !restriction && !["finished","archived"].includes(f.season.status),restriction,options:choices.map(o=>{const amount=BigInt(pool.find(p=>p.marketId===market.id && p.optionId===o.id)?.amount??"0");return {id:o.id,label:o.label,pool:amount.toString(),percent:total?Number(amount*BigInt(10000)/total)/100:0,winner:latest?.winningOptionIds.includes(o.id)??false};}),mine:invested?{optionId:invested.optionId,amount:invested.amount,payout:payout?.amount.toString()??null,profit:payout?.profit.toString()??null}:null});
  }
  return result;
}
