import { computeSeriesProgress } from "@/lib/matches/result-rules";
import { officialMatchCondition } from "@/lib/matches/scope";
import "server-only";
import { createHash } from "node:crypto";
import { and, eq, desc, asc, sql, or, lt, inArray } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import { betPrograms as programs, betAccounts as accounts, betMarkets as markets, betOptions as options, betStakes as stakes, betLedger as ledger, betSettlements as settlements, betStageMilestones as milestones, users, matches, matchMaps, matchVetoSessions, majorStageRuns } from "@/db/schema";
import { betRosterRestriction } from "./admission";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAuditInTx } from "@/lib/audit/write";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { distributePool } from "./pool";
import { resolveMarketOptions } from "./resolution";
import { loadBetFacts, type BetFacts } from "./facts";
import { marketIsLocked, resolveBetFact, subjectMatches } from "./domain";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import catalogContract from "./catalog-contract.json";
import { BET_CATALOG_VERSION, BET_POLICY, roundLineTwice, seriesLineTwice } from "./policy";
import type { BetSubject, MarketType } from "./types";
import type { BetReliefClaimDTO } from "./relief";
import { betReliefDay, readBetRelief } from "./relief-data";
import { canPublishBetRelief } from "./ledger-publication";
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
export function betFactInput(m: Pick<typeof markets.$inferSelect,"type"|"subject"|"line"|"voidedAt"|"matchId">,facts: BetFacts) {return {...m,match:facts.official.find(x=>x.id===m.matchId),maps:facts.maps.filter(x=>x.matchId===m.matchId),veto:facts.vetoByMatch.get(m.matchId??""),event:facts.event};}
async function publishMarkets(tx: TxDb,f: BetFacts) {
  const seasonId=f.season.id;
  const program=await tx.query.betPrograms.findFirst({where:eq(programs.seasonId,seasonId)});
  // Every existing BP pool freezes its terms, including empty or terminal history.
  // Presence adoption also prevents rollback to ordered rules after subject correction.
  const catalog=await tx.select({id:markets.id,matchId:markets.matchId,marketKey:markets.marketKey,type:markets.type,
    subject:markets.subject,line:markets.line,lockedAt:markets.lockedAt,voidedAt:markets.voidedAt}).from(markets).where(eq(markets.seasonId,seasonId));
  const known = new Set(catalog.map(market=>market.marketKey));
  const planned: {row: typeof markets.$inferInsert; choices: {key:string;label:string}[]}[] = [];
  function planMarket(seasonId: string, matchId: string|null, type: MarketType, subject: BetSubject, choices: {key:string;label:string}[], line: number|null=null) {
    const marketKey = `${matchId??"event"}/${type}/${digest(subject)}`;
    if (choices.length < 2 || known.has(marketKey)) return;
    known.add(marketKey);
    planned.push({row:{seasonId,matchId,type,subject,line,marketKey},choices});
  }
  const bpMarkets=catalog.filter(m=>m.type.startsWith("veto_"));
  const publishesPresence=(catalogContract.capabilities?.bo3BpPresence?.publisherVersion ?? 0) >= 1;
  const existing=catalog.filter(m=>m.type==="total_rounds");
  const earlyEventPublication = (catalogContract.capabilities?.eventBeforeSeeds?.publisherVersion ?? 0) >= 1;
  if (!f.event.started && f.eventPublication.entrantsReady && (earlyEventPublication || f.eventPublication.seedsConfirmed)) {
    const subject: BetSubject={kind:"event",entryIds:f.event.entryIds,playerIds:f.event.playerIds};
    planMarket(seasonId,null,"champion",{...subject,playerIds:[]},f.event.entryIds.map(id=>({key:id,label:f.entries.find(e=>e.id===id)?.name??"队伍"})));
    if (f.eventPublication.rostersReady) planMarket(seasonId,null,"top_fragger",subject,f.players.map(p=>({key:p.id,label:p.name})));
  }
  for (const m of f.official) {
    if (!m.majorStageRunId && !m.qualificationRunId || m.entryRound==="third_place" || m.isForfeit || m.status==="finished" || m.status==="cancelled") continue;
    // Existing BP-era starts cannot prove a pre-game window after feature activation.
    const legacyStart=Boolean(m.operationalStartedAt && program && m.operationalStartedAt < program.createdAt && !m.gameplayStartedAt);
    if (legacyStart && !f.maps.some(map=>map.matchId===m.id && map.completedAt && map.completedAt >= program!.createdAt)) continue;
    const veto=f.vetoByMatch.get(m.id);
    const subject: BetSubject={kind:"match",entryIds:[m.entryAId,m.entryBId],runId:(m.majorStageRunId??m.qualificationRunId)!,format:m.format,mapPool:[]};
    const teams=subject.entryIds.map(id=>({key:id,label:f.entries.find(e=>e.id===id)?.name??"队伍"}));
    if (!m.startedAt && !legacyStart) {
      planMarket(seasonId,m.id,"match_winner",subject,teams);
      if (m.format!=="bo1") {
        const target=m.format==="bo3"?2:3;
        const scores=Array.from({length:target},(_,i)=>({key:`${target}:${i}`,label:`${target}:${i}`})).concat(Array.from({length:target},(_,i)=>({key:`${target-1-i}:${target}`,label:`${target-1-i}:${target}`})));
        planMarket(seasonId,m.id,"exact_score",subject,scores);
        planMarket(seasonId,m.id,"total_maps",subject,[{key:"over",label:"大"},{key:"under",label:"小"}],seriesLineTwice(m.format));
      }
      const pool=veto?.mapPoolSnapshot??normalizeRegistrationConfig(f.season.registrationConfig).mapPool;
      if (!veto?.startedAt && pool.length>=Number(m.format.slice(2)) && !bpMarkets.some(market=>market.type==="veto_present" && market.matchId===m.id)) {
        const bpSubject={...subject,mapPool:[...pool].sort()};
        const choices=pool.map(name=>({key:name,label:name.replace(/^de_/,"").replace(/^./,c=>c.toUpperCase())}));
        if (m.format==="bo3" && publishesPresence) {
          // Never convert or supplement an old BP pool, even after identity corrections.
          if (pool.length===7 && new Set(pool).size===7 && !bpMarkets.some(market=>market.matchId===m.id))
            planMarket(seasonId,m.id,"veto_present",bpSubject,choices);
        } else {
          planMarket(seasonId,m.id,m.format==="bo1"?"veto_map":"veto_first",bpSubject,choices);
          if(m.format!=="bo1") planMarket(seasonId,m.id,"veto_decider",bpSubject,choices);
        }
      }
    }
    const maps=f.maps.filter(x=>x.matchId===m.id).sort((a,b)=>a.mapOrder-b.mapOrder);
    const history=f.maps.filter(x=>x.completedAt && x.scoreA!==null && x.scoreB!==null).sort((a,b)=>b.completedAt!.getTime()-a.completedAt!.getTime());
    if (catalogContract.publisherVersion >= 2) for (let mapOrder=1;mapOrder<=Number(m.format.slice(2));mapOrder++) {
      const slot: BetSubject={kind:"map_slot",entryIds:subject.entryIds,runId:subject.runId,format:m.format,mapOrder};
      const input={type:"total_rounds" as const,subject:slot,line:null,voidedAt:null,match:m,maps,veto,event:f.event};
      if (marketIsLocked(input) || (legacyStart && mapOrder===1)) continue;
      // Preserve every legacy pool (including terminal history) for this match/slot.
      // A map name/ID correction does not authorize replacing its invested terms.
      if (existing.some(market => market.matchId===m.id && market.subject.kind==="map" && market.subject.mapOrder===mapOrder && subjectMatches({
        kind:"map_slot",entryIds:market.subject.entryIds,runId:market.subject.runId,format:market.subject.format,mapOrder:market.subject.mapOrder,
      },m,maps,veto))) continue;
      const map=maps.find(x=>x.mapOrder===mapOrder);
      const recent=map?history.filter(x=>x.id!==map.id && x.mapName===map.mapName && f.official.some(match=>match.id===x.matchId && [match.entryAId,match.entryBId].some(id=>subject.entryIds.includes(id)))).slice(0,20):[];
      planMarket(seasonId,m.id,"total_rounds",slot,[{key:"over",label:"大"},{key:"under",label:"小"}],roundLineTwice(recent.map(x=>x.scoreA!+x.scoreB!),history.slice(0,60).map(x=>x.scoreA!+x.scoreB!)));
    }
    if (!veto?.completedAt || veto.pendingAppeal) continue;
    const map=maps.find(x=>!x.completedAt);
    if (!map || map.startedAt || (map.mapOrder===1 && m.startedAt) || maps.filter(x=>x.mapOrder<map.mapOrder).some(x=>!x.completedAt)) continue;
    if (computeSeriesProgress(m.format,maps.filter(x=>x.completedAt)).seriesFinished) continue;
    const mapSubject: BetSubject={kind:"map",entryIds:subject.entryIds,runId:subject.runId,format:m.format,mapId:map.id,mapOrder:map.mapOrder,mapName:map.mapName};
    if (m.format!=="bo1") planMarket(seasonId,m.id,"map_winner",mapSubject,teams);
    if (catalogContract.publisherVersion >= 2) continue;
    const legacyHistory=f.maps.filter(x=>x.completedAt && x.scoreA!==null && x.scoreB!==null && x.id!==map.id).sort((a,b)=>b.completedAt!.getTime()-a.completedAt!.getTime());
    const recent=legacyHistory.filter(x=>x.mapName===map.mapName && f.official.some(match=>match.id===x.matchId && [match.entryAId,match.entryBId].some(id=>subject.entryIds.includes(id)))).slice(0,20);
    // A compatible older publisher must never duplicate a newer slot pool.
    if (existing.some(market=>market.matchId===m.id && market.subject.kind==="map_slot" && market.subject.mapOrder===map.mapOrder && subjectMatches(market.subject,m,maps,veto))) continue;
    planMarket(seasonId,m.id,"total_rounds",mapSubject,[{key:"over",label:"大"},{key:"under",label:"小"}],roundLineTwice(recent.map(x=>x.scoreA!+x.scoreB!),legacyHistory.slice(0,60).map(x=>x.scoreA!+x.scoreB!)));
  }
  if (planned.length) {
    // Batch sizes bound SQL parameter counts while preserving the program transaction.
    for (let start=0;start<planned.length;start+=500) {
      const batch=planned.slice(start,start+500);
      const inserted=await tx.insert(markets).values(batch.map(item=>item.row)).onConflictDoNothing().returning();
      const byKey=new Map(batch.map(item=>[item.row.marketKey,item.choices]));
      const optionRows=inserted.flatMap(market=>(byKey.get(market.marketKey)??[]).map((choice,position)=>({...choice,position,marketId:market.id})));
      if (optionRows.length) await tx.insert(options).values(optionRows);
      catalog.push(...inserted);
    }
  }
  return catalog;
}
/** Caller holds only Bet program lock; official rows are read, never locked by workers. */
export async function reconcileBetInTx(tx: TxDb,seasonId: string) {
  const f=await loadBetFacts(tx,seasonId);
  const all=await publishMarkets(tx,f);
  const now=new Date();
  // Keep database round trips bounded while the shared program lock is held.
  const marketIds=all.map(market=>market.id);
  const allChoices=marketIds.length ? await tx.select({id:options.id,marketId:options.marketId,key:options.key}).from(options).where(inArray(options.marketId,marketIds)) : [];
  const allStakes=marketIds.length ? await tx.select({marketId:stakes.marketId,accountId:stakes.accountId,optionId:stakes.optionId,amount:stakes.amount}).from(stakes).where(inArray(stakes.marketId,marketIds)) : [];
  const latest=marketIds.length ? await tx.selectDistinctOn([settlements.marketId],{id:settlements.id,marketId:settlements.marketId,revision:settlements.revision,fingerprint:settlements.fingerprint}).from(settlements)
    .where(inArray(settlements.marketId,marketIds)).orderBy(asc(settlements.marketId),desc(settlements.revision)) : [];
  const choicesByMarket=new Map<string,typeof allChoices>();
  for(const choice of allChoices) {
    const rows=choicesByMarket.get(choice.marketId) ?? [];
    rows.push(choice);choicesByMarket.set(choice.marketId,rows);
  }
  const stakesByMarket=new Map<string,typeof allStakes>();
  for(const stake of allStakes) {
    const rows=stakesByMarket.get(stake.marketId) ?? [];
    rows.push(stake);stakesByMarket.set(stake.marketId,rows);
  }
  const previousByMarket=new Map(latest.map(batch=>[batch.marketId,batch]));
  let oldLedger: Pick<typeof ledger.$inferSelect,"id"|"accountId"|"amount"|"profit"|"source">[] | undefined;
  const ledgerRows: (typeof ledger.$inferInsert)[] = [];
  for(const market of all) {
    // A pre-seeding admin rollback temporarily removes the frozen player set.
    // Do not terminally void an otherwise valid no-stake Top Fragger market
    // until a new frozen roster can be compared against its immutable terms.
    if (market.type === "top_fragger" && !f.eventPublication.rostersReady && !f.event.started) continue;
    const input=betFactInput(market,f);
    const fact=resolveBetFact(input);
    if (!market.lockedAt && (marketIsLocked(input) || fact.state!=="pending")) await tx.update(markets).set({lockedAt:now}).where(eq(markets.id,market.id));
    // A changed subject is permanently void, even if the official facts later revert.
    if (fact.state==="void" && !market.voidedAt) await tx.update(markets).set({voidedAt:now,voidReason:"官方事实更正或比赛取消"}).where(eq(markets.id,market.id));
    const choices=choicesByMarket.get(market.id) ?? [];
    const rows=stakesByMarket.get(market.id) ?? [];
    const resolved=resolveMarketOptions(choices,fact);
    const total=rows.reduce((n,s)=>n+s.amount,BigInt(0));
    const winning=rows.filter(s=>resolved.winningOptionIds.includes(s.optionId)).reduce((n,s)=>n+s.amount,BigInt(0));
    const state=resolved.state==="settled" && (winning===BigInt(0) || winning===total)?"refunded":resolved.state;
    const winningOptionIds=resolved.state==="settled"?resolved.winningOptionIds:[];
    const fingerprint=JSON.stringify({state,winningOptionIds,fact:resolved.factRevision});
    const previous=previousByMarket.get(market.id);
    if(previous?.fingerprint===fingerprint) continue;
    if(previous && oldLedger===undefined) oldLedger=await tx.select({id:ledger.id,accountId:ledger.accountId,amount:ledger.amount,profit:ledger.profit,source:ledger.source}).from(ledger).where(and(eq(ledger.seasonId,seasonId),inArray(ledger.source,latest.map(batch=>`settlement/${batch.id}`))));
    const [batch]=await tx.insert(settlements).values({marketId:market.id,revision:(previous?.revision??0)+1,state,winningOptionIds,fingerprint}).returning();
    if(previous) {
      const old=oldLedger!.filter(row=>row.source===`settlement/${previous.id}`);
      for(const row of old) ledgerRows.push({seasonId,accountId:row.accountId,amount:-row.amount,profit:-row.profit,kind:"reversal",source:`reversal/${batch!.id}/${row.id}`});
    }
    if(state!=="pending") {
      const payouts=distributePool(rows.map(s=>({accountId:s.accountId,optionId:s.optionId,stake:s.amount})),state==="settled"?winningOptionIds:null);
      const invested=new Map<string,bigint>();
      for (const row of rows) invested.set(row.accountId,(invested.get(row.accountId)??BigInt(0))+row.amount);
      for(const [accountId,amount] of payouts) ledgerRows.push({seasonId,accountId,amount,profit:amount-(invested.get(accountId)??BigInt(0)),kind:"settlement",source:`settlement/${batch!.id}`});
    }
  }
  for (let start=0;start<ledgerRows.length;start+=1000) {
    await tx.insert(ledger).values(ledgerRows.slice(start,start+1000)).onConflictDoNothing({target:[ledger.accountId,ledger.source]});
  }
  // Recover canonical launches even when the StageRun predates BET activation.
  // Keep database timestamp precision and the immutable first launch per stage key.
  await tx.insert(milestones).select(tx.select({seasonId: majorStageRuns.seasonId, stageKey: majorStageRuns.stageKey, openedAt: sql<Date>`min(${majorStageRuns.startedAt})`.as("opened_at")})
    .from(majorStageRuns).where(eq(majorStageRuns.seasonId, seasonId)).groupBy(majorStageRuns.seasonId, majorStageRuns.stageKey))
    .onConflictDoNothing();
  await tx.execute(sql`insert into ${ledger} (season_id, account_id, amount, kind, source)
    select ${accounts.seasonId}, ${accounts.id}, ${BET_POLICY.stagePoints.toString()}::bigint, 'stage', 'stage/' || ${milestones.stageKey}
    from ${accounts} join ${milestones} on ${milestones.seasonId} = ${accounts.seasonId}
    where ${accounts.seasonId} = ${seasonId} and ${accounts.joinedAt} < ${milestones.openedAt}
    on conflict (account_id, source) do nothing`);
  await tx.update(programs).set({dirty:false,catalogVersion:BET_CATALOG_VERSION,updatedAt:now}).where(eq(programs.seasonId,seasonId));
  return f;
}
export async function joinBetInTx(tx:TxDb,seasonId:string,userId:string) {
  await activeUser(tx,userId); await assertSeasonAllowsTournamentMutationInTx(tx,seasonId); await lockBetProgram(tx,seasonId);
  const [account]=await tx.insert(accounts).values({seasonId,userId}).onConflictDoNothing().returning();
  if(account) await writeLedger(tx,{seasonId,accountId:account.id,amount:BET_POLICY.initialPoints,kind:"initial",source:"initial"});
}
/** Same serialization owner as stake, stage grants, refunds and correction/debt. */
export async function claimBetReliefInTx(tx: TxDb, input: {seasonId: string; userId: string; day: string}): Promise<BetReliefClaimDTO> {
  if (!canPublishBetRelief()) invalid("低保领取尚未开放");
  await activeUser(tx, input.userId);
  await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
  const program = await lockBetProgram(tx, input.seasonId);
  const day = await betReliefDay(tx);
  if (input.day !== day) invalid("日期已更新，请刷新后领取低保");
  const eligibility = await readBetRelief(tx, input.seasonId, input.userId, day);
  if (program.paused || eligibility.reason === "season_closed") invalid("赛事已结束或暂停领取");
  const account = await tx.query.betAccounts.findFirst({where: and(eq(accounts.seasonId, input.seasonId), eq(accounts.userId, input.userId))});
  if (!account) invalid("请先领取本届积分");
  const source = `relief/${day}`;
  const replay = await tx.query.betLedger.findFirst({where: and(eq(ledger.accountId, account.id), eq(ledger.source, source))});
  if (replay) return {day, amount: replay.amount.toString(), replayed: true, eligibility};
  if (!eligibility.canClaim) invalid(eligibility.reason === "debt" ? "待抵扣差额不能领取低保" : eligibility.reason === "limit_reached" ? "本届低保额度已用尽" : "余额不足10积分时才可领取低保");
  await writeLedger(tx, {seasonId: input.seasonId, accountId: account.id, amount: BigInt(eligibility.amount), profit: BigInt(0), kind: "relief", source});
  return {day, amount: eligibility.amount, replayed: false, eligibility: await readBetRelief(tx, input.seasonId, input.userId, day)};
}
export async function stakeBetInTx(tx:TxDb,input:{seasonId:string;userId:string;marketId:string;optionId:string;amount:string;requestId:string}) {
  await activeUser(tx,input.userId); await assertSeasonAllowsTournamentMutationInTx(tx,input.seasonId);
  const target=await tx.query.betMarkets.findFirst({where:and(eq(markets.id,input.marketId),eq(markets.seasonId,input.seasonId))});
  if(!target) invalid("盘口不存在");
  // Official mutation lock order: user → lifecycle → match → map/veto → Bet program.
  const matchRows=await tx.select().from(matches).where(and(officialMatchCondition(), target.matchId?eq(matches.id,target.matchId):eq(matches.seasonId,input.seasonId))).orderBy(asc(matches.id)).for("share");
  const matchIds = matchRows.map(match => match.id);
  if (matchIds.length > 0) {
    await tx.select({id:matchMaps.id}).from(matchMaps).where(inArray(matchMaps.matchId,matchIds)).orderBy(asc(matchMaps.id)).for("share");
    await tx.select({id:matchVetoSessions.matchId}).from(matchVetoSessions).where(inArray(matchVetoSessions.matchId,matchIds)).orderBy(asc(matchVetoSessions.matchId)).for("share");
  }
  const program=await lockBetProgram(tx,input.seasonId);
  const account=await tx.query.betAccounts.findFirst({where:and(eq(accounts.seasonId,input.seasonId),eq(accounts.userId,input.userId))});
  if(!account) invalid("请先领取本届积分");
  const replay=await tx.query.betStakes.findFirst({where:and(eq(stakes.accountId,account.id),eq(stakes.requestId,input.requestId))});
  if(replay) {
    if(replay.marketId!==input.marketId || replay.optionId!==input.optionId || replay.allIn!==(input.amount==="all") || !replay.allIn && replay.amount.toString()!==input.amount) invalid("重复请求标识与内容不一致");
    return {amount:replay.amount.toString()};
  }
  const facts=await loadBetFacts(tx,input.seasonId,{matchId:target.matchId??undefined,event:!target.matchId,rosterUserId:target.matchId?input.userId:undefined});
  const market=await tx.query.betMarkets.findFirst({where:eq(markets.id,target.id)});
  if(program.paused || !market || market.lockedAt || marketIsLocked(betFactInput(market,facts)) || resolveBetFact(betFactInput(market,facts)).state!=="pending") invalid("盘口已锁定或暂停投入");
  const restriction = betRosterRestriction(input.userId, market.subject, facts.roster);
  if (restriction) throw new AppError(ErrorCode.FORBIDDEN, restriction);
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
    if(input.operation==="void" && target.voidedAt) invalid("盘口已作废，不能修改退款原因");
    // Preserve PostgreSQL microseconds; round-tripping an existing Date changes a frozen lock.
    await tx.update(markets).set({lockedAt:sql`coalesce(${markets.lockedAt},clock_timestamp())`,...(input.operation==="void"?{voidedAt:sql`clock_timestamp()`,voidReason:input.reason}: {})}).where(eq(markets.id,target.id));
  }
  await writeAuditInTx(tx,{seasonId:input.seasonId,actorId:input.actorId,action:`bet.${input.operation}`,targetId:input.marketId??input.seasonId,meta:{reason:input.reason??null}});
  await reconcileBetInTx(tx,input.seasonId);
}
export async function runBetReconciliationJob(database:DB=db) {
  const due=await database.select().from(programs).where(or(eq(programs.dirty,true),lt(programs.catalogVersion,BET_CATALOG_VERSION))).orderBy(asc(programs.updatedAt)).limit(10);
  for(const program of due) await database.transaction(async tx=>{await lockBetProgram(tx,program.seasonId);await reconcileBetInTx(tx,program.seasonId);});
  return due.length;
}
