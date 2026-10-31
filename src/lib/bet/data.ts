import { projectDisplayScore } from "@/lib/matches/display-score";
import { betOptionEntity } from "./option-entity";
import "server-only";
import { and, eq, asc, desc, sql, isNotNull, isNull, inArray, notInArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { betPrograms, betAccounts, betMarkets, betOptions, betStakes, betSettlements, betLedger, users } from "@/db/schema";
import { betRosterRestriction } from "./admission";
import { readBetAccounts, type BetAccountReadOptions } from "./account-data";
import { loadBetFacts, type BetFacts } from "./facts";
import { betFactInput } from "./service";
import { marketIsLocked, resolveBetFact } from "./domain";
import { marketPresentation, marketContext } from "./presentation";
import type { BetBoardDTO, BetState } from "./types";
/** Read-only repeatable-read snapshot. Never create markets or settle from GET. */
export interface BetBoardReadOptions extends BetAccountReadOptions {
  facts?: BetFacts;
  view?: string;
  matchId?: string;
  includeEvent?: boolean;
  publicPools?: Awaited<ReturnType<typeof readBetPools>>;
}
export async function readBetPools(tx: TxDb, seasonId: string, scope: Pick<BetBoardReadOptions, "matchId" | "includeEvent" | "view"> = {}) {
  const marketScope=and(eq(betMarkets.seasonId,seasonId),scope.view==="event"?isNull(betMarkets.matchId):undefined,scope.matchId?eq(betMarkets.matchId,scope.matchId):scope.includeEvent===false?isNotNull(betMarkets.matchId):undefined);
  const marketIds=tx.select({id:betMarkets.id}).from(betMarkets).where(marketScope);
  const grouped=tx.select({marketId:betStakes.marketId,optionId:sql<string | null>`${betStakes.optionId}`.as("option_id"),amount:sql<string>`sum(${betStakes.amount})::text`.as("amount"),count:sql<number>`count(distinct ${betStakes.accountId})::int`.as("count")})
    .from(betStakes).where(and(eq(betStakes.seasonId,seasonId),inArray(betStakes.marketId,marketIds)))
    .groupBy(sql`grouping sets ((${betStakes.marketId}, ${betStakes.optionId}), (${betStakes.marketId}))`).as("pool_groups");
  const rows=await tx.select({marketId:grouped.marketId,
    options:sql<[string,string][]>`coalesce(jsonb_agg(jsonb_build_array(${grouped.optionId}, ${grouped.amount})) filter (where ${grouped.optionId} is not null), '[]'::jsonb)`,
    count:sql<number>`max(${grouped.count}) filter (where ${grouped.optionId} is null)`})
    .from(grouped).groupBy(grouped.marketId);
  return {
    pool: rows.flatMap(row=>row.options.map(([optionId,amount])=>({marketId:row.marketId,optionId,amount}))),
    counts: rows.map(row=>({marketId:row.marketId,count:row.count})),
  };
}
export async function readBetBoardSnapshot(tx:TxDb,seasonId:string,userId:string|null, options:BetBoardReadOptions = {}) {
  const [viewer]=await tx.select({program:betPrograms,account:betAccounts,user:{role:users.role,status:users.status,emailVerifiedAt:users.emailVerifiedAt}})
    .from(betPrograms)
    .leftJoin(betAccounts,and(eq(betAccounts.seasonId,betPrograms.seasonId),userId?eq(betAccounts.userId,userId):sql`false`))
    .leftJoin(users,userId?eq(users.id,userId):sql`false`)
    .where(eq(betPrograms.seasonId,seasonId)).limit(1);
  const program=viewer?.program;
  const account=viewer?.account;
  const user=viewer?.user;

  const f=options.facts ?? await loadBetFacts(tx,seasonId,{matchId:options.matchId,event:options.includeEvent,rosterUserId:options.includeEvent === false ? userId : undefined});
  const joinReason=!userId?"登录后领取初始积分":!user||user.status!=="active"||!user.emailVerifiedAt?"请先完成邮箱验证并重新登录":f.season.status==="archived"?"赛事已归档，不能领取积分":account?"已领取本届初始积分":null;
  const { balance, profit, rank, leaderboard, records, recordsHasMore, recordsNextCursor } = await readBetAccounts(tx, seasonId, account?.id, f, options);
  const settled = tx.selectDistinctOn([betSettlements.marketId], {marketId:betSettlements.marketId,state:betSettlements.state})
    .from(betSettlements).innerJoin(betMarkets,eq(betMarkets.id,betSettlements.marketId))
    .where(eq(betMarkets.seasonId,seasonId)).orderBy(betSettlements.marketId,desc(betSettlements.revision)).as("view_settlements");
  const marketScope=and(eq(betMarkets.seasonId,seasonId),
    ["records","leaderboard"].includes(options.view??"") ? sql`false` : undefined,
    options.view === "event" ? isNull(betMarkets.matchId) : undefined,
    options.view === "mine" ? account ? inArray(betMarkets.id,tx.select({id:betStakes.marketId}).from(betStakes).where(eq(betStakes.accountId,account.id))) : sql`false` : undefined,
    options.view === "settled" ? inArray(betMarkets.id,tx.select({id:settled.marketId}).from(settled).where(inArray(settled.state,["settled","refunded"]))) : undefined,
    options.view === "open" ? notInArray(betMarkets.id,tx.select({id:settled.marketId}).from(settled).where(inArray(settled.state,["settled","refunded"]))) : undefined,
    options.matchId?eq(betMarkets.matchId,options.matchId):options.includeEvent===false?isNotNull(betMarkets.matchId):undefined);
  const headerOnly = ["records","leaderboard"].includes(options.view??"");
  const all=headerOnly ? [] : await tx.select({id:betMarkets.id,matchId:betMarkets.matchId,type:betMarkets.type,subject:betMarkets.subject,line:betMarkets.line,lockedAt:betMarkets.lockedAt,voidedAt:betMarkets.voidedAt}).from(betMarkets).where(marketScope).orderBy(asc(betMarkets.createdAt),asc(betMarkets.id));
  const marketIds=tx.select({id:betMarkets.id}).from(betMarkets).where(marketScope);
  const {pool,counts}=headerOnly ? {pool:[],counts:[]} : options.publicPools ?? await readBetPools(tx,seasonId,options);
  const myStakes=!headerOnly && account?await tx.select({marketId:betStakes.marketId,optionId:betStakes.optionId,amount:sql<string>`sum(${betStakes.amount})::text`}).from(betStakes).where(and(eq(betStakes.accountId,account.id),inArray(betStakes.marketId,marketIds))).groupBy(betStakes.marketId,betStakes.optionId):[];
  const allOptions=headerOnly ? [] : await tx.select({option:betOptions}).from(betOptions).innerJoin(betMarkets,eq(betMarkets.id,betOptions.marketId)).where(marketScope).orderBy(asc(betOptions.position)).then(rows=>rows.map(r=>r.option));
  const latestSettlements=headerOnly ? [] : await tx.selectDistinctOn([betSettlements.marketId],{batch:betSettlements}).from(betSettlements).innerJoin(betMarkets,eq(betMarkets.id,betSettlements.marketId)).where(marketScope).orderBy(asc(betSettlements.marketId),desc(betSettlements.revision)).then(rows=>rows.map(r=>r.batch));
  const myPayouts=account && latestSettlements.length?await tx.select().from(betLedger).where(and(eq(betLedger.accountId,account.id),eq(betLedger.kind,"settlement"),inArray(betLedger.source,latestSettlements.map(s=>`settlement/${s.id}`)))):[];
  return {seasonId,userId,program,account,user,f,joinReason,balance,profit,rank,leaderboard,records,recordsHasMore,recordsNextCursor,
    all,pool,counts,myStakes,allOptions,latestSettlements,myPayouts};
}
export function projectBetBoard(snapshot: Awaited<ReturnType<typeof readBetBoardSnapshot>>): BetBoardDTO {
  const {seasonId,userId,program,account,user,f,joinReason,balance,profit,rank,leaderboard,records,recordsHasMore,recordsNextCursor,
    all,pool,counts,myStakes,allOptions,latestSettlements,myPayouts}=snapshot;
  if (!program) return {seasonId,enabled:false,paused:false,joined:false,balance:"0",debt:"0",profit:"0",rank:null,leaderboard:[],records:[],markets:[],matches:[]};
  const result:BetBoardDTO={seasonId,enabled:!!program,paused:program?.paused??false,joined:!!account,joinEligibility:{canJoin:joinReason===null,reason:joinReason},balance:(balance>BigInt(0)?balance:BigInt(0)).toString(),debt:(balance<BigInt(0)?-balance:BigInt(0)).toString(),profit,rank,leaderboard,records,recordsHasMore,recordsNextCursor,markets:[],matches:f.official.map(m=>({id:m.id,entryAId:m.entryAId,entryBId:m.entryBId,a:f.entries.find(e=>e.id===m.entryAId)?.name??"队伍",b:f.entries.find(e=>e.id===m.entryBId)?.name??"队伍",logoA:f.entries.find(e=>e.id===m.entryAId)?.logoUrl??null,logoB:f.entries.find(e=>e.id===m.entryBId)?.logoUrl??null,stage:m.qualificationRunId?"PLAY-IN":f.season.stagePlan.find(s=>s.key===m.stage)?.name??"正赛",format:m.format.toUpperCase(),scheduledAt:m.scheduledAt?.toISOString()??null,status:m.status,displayScore:projectDisplayScore(m,f.maps.filter(map=>map.matchId===m.id))}))};
  for (const market of all) {
    if (market.matchId && market.subject.kind !== "event" && !result.matches.some(m => m.id === market.matchId)) {
      const subject = market.subject;
      const a = f.entries.find(e => e.id === subject.entryIds[0]);
      const b = f.entries.find(e => e.id === subject.entryIds[1]);
      result.matches.push({id:market.matchId,entryAId:subject.entryIds[0],entryBId:subject.entryIds[1],a:a?.name??"队伍",b:b?.name??"队伍",logoA:a?.logoUrl??null,logoB:b?.logoUrl??null,stage:"已更正比赛",format:subject.format.toUpperCase(),scheduledAt:null});
    }
    const latest=latestSettlements.find(s=>s.marketId===market.id);
    const choices=allOptions.filter(o=>o.marketId===market.id);
    const input=betFactInput(market,f); const current=resolveBetFact(input);
    const state:BetState=latest && latest.state!=="pending"?latest.state:market.lockedAt||marketIsLocked(input)||current.state!=="pending"?"locked":"open";
    const total=pool.filter(p=>p.marketId===market.id).reduce((n,p)=>n+BigInt(p.amount),BigInt(0));
    const invested=myStakes.find(s=>s.marketId===market.id);
    const payout=latest && invested && account && latest.state!=="pending"?myPayouts.find(row=>row.source===`settlement/${latest.id}`):null;
    const restriction=user && (user.status!=="active" || !user.emailVerifiedAt)?"请先完成邮箱验证":betRosterRestriction(userId, market.subject, f.roster);
    const presentation=marketPresentation(market.type,market.line);
    result.markets.push({id:market.id,matchId:market.matchId,type:market.type,...presentation,context:marketContext(market.subject,input.maps),state,pool:total.toString(),participants:counts.find(c=>c.marketId===market.id)?.count??0,canStake:!!account && !!program && !program.paused && state==="open" && !restriction && !["finished","archived"].includes(f.season.status),restriction,options:choices.map(o=>{const amount=BigInt(pool.find(p=>p.marketId===market.id && p.optionId===o.id)?.amount??"0");return {id:o.id,label:o.label,entity:betOptionEntity(market.type,market.subject,o.key),pool:amount.toString(),percent:total?Number(amount*BigInt(10000)/total)/100:0,winner:latest?.winningOptionIds.includes(o.id)??false};}),mine:invested?{optionId:invested.optionId,amount:invested.amount,payout:payout?.amount.toString()??null,profit:payout?.profit.toString()??null}:null});
  }
  return result;
}

/** Compatibility entrypoint for callers already owning a transaction. */
export async function betBoard(tx: TxDb, seasonId: string, userId: string | null, options: BetBoardReadOptions = {}) {
  return projectBetBoard(await readBetBoardSnapshot(tx,seasonId,userId,options));
}

/** Admin uses all market facts but has no spectator account/history consumer. */
export async function readBetOperationsSnapshot(tx:TxDb,seasonId:string) {
  return readBetBoardSnapshot(tx,seasonId,null,{leaderboard:false,records:false});
}
