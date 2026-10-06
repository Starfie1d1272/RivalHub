import "server-only";
import { createHash } from "node:crypto";
import { and, eq, desc, asc, sql } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import { betPrograms as programs, betAccounts as accounts, betMarkets as markets, betOptions as options, betStakes as stakes, betLedger as ledger, betSettlements as settlements, betStageMilestones as milestones, users, matches, matchMaps, matchVetoSessions, seasonAdminGrants } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAuditInTx } from "@/lib/audit/write";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { distributePool } from "./pool";
import { resolveMarketOptions } from "./resolution";
import { loadBetFacts, type BetFacts } from "./facts";
import { marketIsLocked, resolveBetFact } from "./domain";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import { BET_POLICY, roundLineTwice, seriesLineTwice } from "./policy";
import type { BetSubject, MarketType } from "./types";
function invalid(message: string): never {throw new AppError(ErrorCode.VALIDATION_FAILED,message);}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0,24);
export async function lockBetProgram(tx: TxDb,seasonId: string) {
  const [program] = await tx.select().from(programs).where(eq(programs.seasonId,seasonId)).for("update");
  if (!program) invalid("BET 尚未开放");
  return program;
}
async function activeUser(tx: TxDb,userId: string) {
  const [user] = await tx.select().from(users).where(eq(users.id,userId)).for("share");
  if (!user || user.status!=="active" || !user.emailVerifiedAt) throw new AppError(ErrorCode.FORBIDDEN,"请先完成邮箱验证并重新登录");
  return user;
}
async function writeLedger(tx: TxDb,row: typeof ledger.$inferInsert) {await tx.insert(ledger).values(row).onConflictDoNothing({target:[ledger.accountId,ledger.source]});}
export async function betBalance(tx: TxDb,accountId: string) {
  const [row] = await tx.select({amount:sql<string>`coalesce(sum(${ledger.amount}),0)::text`}).from(ledger).where(eq(ledger.accountId,accountId));
  return BigInt(row?.amount??"0");
}
export function betFactInput(m: typeof markets.$inferSelect,facts: BetFacts) {return {...m,match:facts.official.find(x=>x.id===m.matchId),maps:facts.maps.filter(x=>x.matchId===m.matchId),veto:facts.vetoByMatch.get(m.matchId??""),event:facts.event};}
async function createMarket(tx: TxDb,seasonId: string,matchId: string|null,type: MarketType,subject: BetSubject,choices: {key:string;label:string}[],line: number|null=null) {
  if (choices.length<2) return;
  const marketKey = `${matchId??"event"}/${type}/${digest(subject)}`;
  const [market] = await tx.insert(markets).values({seasonId,matchId,type,subject,line,marketKey}).onConflictDoNothing().returning();
  if (market) await tx.insert(options).values(choices.map((o,position)=>({...o,position,marketId:market.id})));
}
async function publishMarkets(tx: TxDb,f: BetFacts) {
  const seasonId=f.season.id;
  const program=await tx.query.betPrograms.findFirst({where:eq(programs.seasonId,seasonId)});
  if (!f.event.started && f.event.entryIds.length) {
    const subject: BetSubject={kind:"event",entryIds:f.event.entryIds,playerIds:f.event.playerIds};
    await createMarket(tx,seasonId,null,"champion",{...subject,playerIds:[]},f.event.entryIds.map(id=>({key:id,label:f.entries.find(e=>e.id===id)?.name??"队伍"})));
    await createMarket(tx,seasonId,null,"top_fragger",subject,f.players.map(p=>({key:p.id,label:p.name})));
  }
  for (const m of f.official) {
    if (!m.majorStageRunId && !m.qualificationRunId || m.entryRound==="third_place" || m.isForfeit || m.status==="finished" || m.status==="cancelled") continue;
    // Existing BP-era starts cannot prove a pre-game window after feature activation.
    if (m.operationalStartedAt && program && m.operationalStartedAt < program.createdAt && !m.startedAt && !f.maps.some(map=>map.matchId===m.id && map.completedAt)) continue;
    const veto=f.vetoByMatch.get(m.id);
    const subject: BetSubject={kind:"match",entryIds:[m.entryAId,m.entryBId],runId:(m.majorStageRunId??m.qualificationRunId)!,format:m.format,mapPool:[]};
    const teams=subject.entryIds.map(id=>({key:id,label:f.entries.find(e=>e.id===id)?.name??"队伍"}));
    if (!m.startedAt) {
      await createMarket(tx,seasonId,m.id,"match_winner",subject,teams);
      if (m.format!=="bo1") {
        const target=m.format==="bo3"?2:3;
        const scores=Array.from({length:target},(_,i)=>({key:`${target}:${i}`,label:`${target}:${i}`})).concat(Array.from({length:target},(_,i)=>({key:`${target-1-i}:${target}`,label:`${target-1-i}:${target}`})));
        await createMarket(tx,seasonId,m.id,"exact_score",subject,scores);
        await createMarket(tx,seasonId,m.id,"total_maps",subject,[{key:"over",label:"大"},{key:"under",label:"小"}],seriesLineTwice(m.format));
      }
      const pool=veto?.mapPoolSnapshot??normalizeRegistrationConfig(f.season.registrationConfig).mapPool;
      if (!veto?.startedAt && pool.length>=Number(m.format.slice(2))) {
        const bpSubject={...subject,mapPool:[...pool].sort()};
        const choices=pool.map(name=>({key:name,label:name.replace(/^de_/,"").replace(/^./,c=>c.toUpperCase())}));
        await createMarket(tx,seasonId,m.id,m.format==="bo1"?"veto_map":"veto_first",bpSubject,choices);
        if(m.format!=="bo1") await createMarket(tx,seasonId,m.id,"veto_decider",bpSubject,choices);
      }
    }
    if (!veto?.completedAt || veto.pendingAppeal) continue;
    const maps=f.maps.filter(x=>x.matchId===m.id).sort((a,b)=>a.mapOrder-b.mapOrder);
    const map=maps.find(x=>!x.completedAt);
    if (!map || map.startedAt || (map.mapOrder===1 && m.startedAt) || maps.filter(x=>x.mapOrder<map.mapOrder).some(x=>!x.completedAt)) continue;
    const target=m.format==="bo1"?1:m.format==="bo3"?2:3;
    const winsA=maps.filter(x=>x.completedAt && x.scoreA!==null && x.scoreB!==null && x.scoreA>x.scoreB).length;
    const winsB=maps.filter(x=>x.completedAt && x.scoreA!==null && x.scoreB!==null && x.scoreB>x.scoreA).length;
    if (winsA>=target || winsB>=target) continue;
    const mapSubject: BetSubject={kind:"map",entryIds:subject.entryIds,runId:subject.runId,format:m.format,mapId:map.id,mapOrder:map.mapOrder,mapName:map.mapName};
    if (m.format!=="bo1") await createMarket(tx,seasonId,m.id,"map_winner",mapSubject,teams);
    const history=f.maps.filter(x=>x.completedAt && x.scoreA!==null && x.scoreB!==null && x.id!==map.id).sort((a,b)=>b.completedAt!.getTime()-a.completedAt!.getTime());
    const recent=history.filter(x=>x.mapName===map.mapName && f.official.some(match=>match.id===x.matchId && [match.entryAId,match.entryBId].some(id=>subject.entryIds.includes(id)))).slice(0,20);
    await createMarket(tx,seasonId,m.id,"total_rounds",mapSubject,[{key:"over",label:"大"},{key:"under",label:"小"}],roundLineTwice(recent.map(x=>x.scoreA!+x.scoreB!),history.slice(0,60).map(x=>x.scoreA!+x.scoreB!)));
  }
}
/** Caller holds only Bet program lock; official rows are read, never locked by workers. */
export async function reconcileBetInTx(tx: TxDb,seasonId: string) {
  const f=await loadBetFacts(tx,seasonId);
  await publishMarkets(tx,f);
  const now=new Date();
  const all=await tx.select().from(markets).where(eq(markets.seasonId,seasonId));
  for(const market of all) {
    const input=betFactInput(market,f);
    const fact=resolveBetFact(input);
    if (!market.lockedAt && (marketIsLocked(input) || fact.state!=="pending")) await tx.update(markets).set({lockedAt:now}).where(eq(markets.id,market.id));
    // A changed subject is permanently void, even if the official facts later revert.
    if (fact.state==="void" && !market.voidedAt) await tx.update(markets).set({voidedAt:now,voidReason:"官方事实更正或比赛取消"}).where(eq(markets.id,market.id));
    const choices=await tx.select().from(options).where(eq(options.marketId,market.id));
    const rows=await tx.select().from(stakes).where(eq(stakes.marketId,market.id));
    const resolved=resolveMarketOptions(choices,fact);
    const total=rows.reduce((n,s)=>n+s.amount,BigInt(0));
    const winning=rows.filter(s=>resolved.winningOptionIds.includes(s.optionId)).reduce((n,s)=>n+s.amount,BigInt(0));
    const state=resolved.state==="settled" && (winning===BigInt(0) || winning===total)?"refunded":resolved.state;
    const winningOptionIds=resolved.state==="settled"?resolved.winningOptionIds:[];
    const fingerprint=JSON.stringify({state,winningOptionIds,fact:resolved.factRevision});
    const previous=await tx.query.betSettlements.findFirst({where:eq(settlements.marketId,market.id),orderBy:desc(settlements.revision)});
    if(previous?.fingerprint===fingerprint) continue;
    const [batch]=await tx.insert(settlements).values({marketId:market.id,revision:(previous?.revision??0)+1,state,winningOptionIds,fingerprint}).returning();
    if(previous) {
      const old=await tx.select().from(ledger).where(and(eq(ledger.seasonId,seasonId),eq(ledger.source,`settlement/${previous.id}`)));
      for(const row of old) await writeLedger(tx,{seasonId,accountId:row.accountId,amount:-row.amount,profit:-row.profit,kind:"reversal",source:`reversal/${batch!.id}/${row.id}`});
    }
    if(state!=="pending") {
      const payouts=distributePool(rows.map(s=>({accountId:s.accountId,optionId:s.optionId,stake:s.amount})),state==="settled"?winningOptionIds:null);
      for(const [accountId,amount] of payouts) await writeLedger(tx,{seasonId,accountId,amount,profit:amount-rows.filter(s=>s.accountId===accountId).reduce((n,s)=>n+s.amount,BigInt(0)),kind:"settlement",source:`settlement/${batch!.id}`});
    }
  }
  const accountsAll=await tx.select().from(accounts).where(eq(accounts.seasonId,seasonId));
  const launches=await tx.select().from(milestones).where(eq(milestones.seasonId,seasonId));
  for(const launch of launches) for(const a of accountsAll.filter(a=>a.joinedAt<launch.openedAt)) await writeLedger(tx,{seasonId,accountId:a.id,amount:BET_POLICY.stagePoints,kind:"stage",source:`stage/${launch.stageKey}`});
  await tx.update(programs).set({dirty:false,updatedAt:now}).where(eq(programs.seasonId,seasonId));
  return f;
}
export async function joinBetInTx(tx:TxDb,seasonId:string,userId:string) {
  await activeUser(tx,userId); await assertSeasonAllowsTournamentMutationInTx(tx,seasonId); await lockBetProgram(tx,seasonId);
  const [account]=await tx.insert(accounts).values({seasonId,userId}).onConflictDoNothing().returning();
  if(account) await writeLedger(tx,{seasonId,accountId:account.id,amount:BET_POLICY.initialPoints,kind:"initial",source:"initial"});
}
export async function stakeBetInTx(tx:TxDb,input:{seasonId:string;userId:string;marketId:string;optionId:string;amount:string;requestId:string}) {
  const user=await activeUser(tx,input.userId); await assertSeasonAllowsTournamentMutationInTx(tx,input.seasonId);
  const target=await tx.query.betMarkets.findFirst({where:and(eq(markets.id,input.marketId),eq(markets.seasonId,input.seasonId))});
  if(!target) invalid("盘口不存在");
  // Official mutation lock order: user → lifecycle → match → map/veto → Bet program.
  const matchRows=await tx.select().from(matches).where(target.matchId?eq(matches.id,target.matchId):eq(matches.seasonId,input.seasonId)).orderBy(asc(matches.id)).for("share");
  for(const m of matchRows) {
    await tx.select({id:matchMaps.id}).from(matchMaps).where(eq(matchMaps.matchId,m.id)).orderBy(asc(matchMaps.id)).for("share");
    await tx.select({id:matchVetoSessions.matchId}).from(matchVetoSessions).where(eq(matchVetoSessions.matchId,m.id)).for("share");
  }
  const program=await lockBetProgram(tx,input.seasonId);
  const account=await tx.query.betAccounts.findFirst({where:and(eq(accounts.seasonId,input.seasonId),eq(accounts.userId,input.userId))});
  if(!account) invalid("请先领取本届积分");
  const replay=await tx.query.betStakes.findFirst({where:and(eq(stakes.accountId,account.id),eq(stakes.requestId,input.requestId))});
  if(replay) {
    if(replay.marketId!==input.marketId || replay.optionId!==input.optionId || replay.allIn!==(input.amount==="all") || !replay.allIn && replay.amount.toString()!==input.amount) invalid("重复请求标识与内容不一致");
    return {amount:replay.amount.toString()};
  }
  const facts=await loadBetFacts(tx,input.seasonId);
  const market=await tx.query.betMarkets.findFirst({where:eq(markets.id,target.id)});
  if(program.paused || !market || market.lockedAt || marketIsLocked(betFactInput(market,facts)) || resolveBetFact(betFactInput(market,facts)).state!=="pending") invalid("盘口已锁定或暂停投入");
  const admin=await tx.query.seasonAdminGrants.findFirst({where:and(eq(seasonAdminGrants.seasonId,input.seasonId),eq(seasonAdminGrants.userId,input.userId))});
  if(user.role==="super_admin" || admin || facts.roster.some(r=>r.userId===input.userId && market.subject.entryIds.includes(r.entryId))) throw new AppError(ErrorCode.FORBIDDEN,"赛事管理员和相关队伍名单成员不能参与此盘口");
  const option=await tx.query.betOptions.findFirst({where:and(eq(options.id,input.optionId),eq(options.marketId,market.id))});
  if(!option) invalid("所选选项不属于此盘口");
  const previous=await tx.select().from(stakes).where(and(eq(stakes.marketId,market.id),eq(stakes.accountId,account.id)));
  if(previous.some(s=>s.optionId!==input.optionId)) invalid("已经投入其他选项，只能在原选项追加");
  const balance=await betBalance(tx,account.id); const amount=input.amount==="all"?balance:BigInt(input.amount);
  if(amount<=BigInt(0) || amount>balance) invalid("可用积分不足；待抵扣差额需先抵扣");
  const [saved]=await tx.insert(stakes).values({...input,accountId:account.id,amount,allIn:input.amount==="all"}).returning();
  await writeLedger(tx,{seasonId:input.seasonId,accountId:account.id,amount:-amount,kind:"stake",source:`stake/${saved!.id}`});
  return {amount:amount.toString()};
}
export async function operateBetInTx(tx:TxDb,input:{seasonId:string;actorId:string;operation:"enable"|"pause"|"resume"|"close"|"void"|"retry";marketId?:string;reason?:string}) {
  await assertSeasonAllowsTournamentMutationInTx(tx,input.seasonId);
  if(input.operation==="enable") await tx.insert(programs).values({seasonId:input.seasonId}).onConflictDoNothing();
  await lockBetProgram(tx,input.seasonId);
  if(input.operation==="pause" || input.operation==="resume") await tx.update(programs).set({paused:input.operation==="pause"}).where(eq(programs.seasonId,input.seasonId));
  if(input.operation==="close" || input.operation==="void") {
    const target=await tx.query.betMarkets.findFirst({where:and(eq(markets.id,input.marketId!),eq(markets.seasonId,input.seasonId))});
    if(!target) invalid("盘口不存在");
    if(input.operation==="void" && !input.reason?.trim()) invalid("请填写退款原因");
    await tx.update(markets).set({lockedAt:target.lockedAt??new Date(),...(input.operation==="void"?{voidedAt:target.voidedAt??new Date(),voidReason:input.reason}: {})}).where(eq(markets.id,target.id));
  }
  await writeAuditInTx(tx,{seasonId:input.seasonId,actorId:input.actorId,action:`bet.${input.operation}`,targetId:input.marketId??input.seasonId,meta:{reason:input.reason??null}});
  await reconcileBetInTx(tx,input.seasonId);
}
export async function runBetReconciliationJob(database:DB=db) {
  const due=await database.select().from(programs).where(eq(programs.dirty,true)).orderBy(asc(programs.updatedAt)).limit(10);
  for(const program of due) await database.transaction(async tx=>{await lockBetProgram(tx,program.seasonId);await reconcileBetInTx(tx,program.seasonId);});
  return due.length;
}
