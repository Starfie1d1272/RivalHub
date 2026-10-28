import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { TxDb } from "@/db/client";
import { fixture } from "./harness/bet-fixture";
import { betBoard, readBetPools, readBetBoardSnapshot, projectBetBoard } from "@/lib/bet/data";
import { readBetStakeReceipt } from "@/lib/bet/receipt-read";
import { stakeBetInTx } from "@/lib/bet/service";
import { loadBetFacts } from "@/lib/bet/facts";
import { readUnifiedBetBoard } from "@/lib/bet/board-read";
import { readFreePredictionBoard, readFreeMatchSupport } from "@/lib/free-predictions/data";
import { submitFreePredictionInTx } from "@/lib/free-predictions/service";

it("keeps open candidates independent of settled history using the latest settlement revision",async()=>fixture(async f=>{
  const original=(await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)}))!;
  const market=(await f.db.query.betMarkets.findMany({where:eq(schema.betMarkets.matchId,f.matchId)})).find(m=>m.type==="match_winner")!;
  const choices=await f.db.query.betOptions.findMany({where:eq(schema.betOptions.marketId,market.id)});
  const account=(await f.db.query.betAccounts.findFirst({where:eq(schema.betAccounts.userId,f.userId)}))!;
  await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:choices[0]!.id,amount:"10",requestId:randomUUID()}));
  const client=await f.db.$client.connect(),measuredDb=drizzle(client,{schema});
  async function measure(userId:string|null,view?:string,matchId?:string) {
    const options={rows:0,logicalJsonBytes:0},query=client.query;
    client.query=((...args:unknown[])=>{
      const config=args[0] as string|{text:string},text=typeof config==="string"?config:config.text;
      return Promise.resolve(Reflect.apply(query,client,args)).then(value=>{
        if(text.includes('from "bet_options"')){options.rows+=value.rows.length;options.logicalJsonBytes+=Buffer.byteLength(JSON.stringify(value.rows));}
        return value;
      });
    }) as typeof client.query;
    try {
      const snapshot=await measuredDb.transaction(tx=>readBetBoardSnapshot(tx,f.seasonId,userId,{view,matchId,includeEvent:false,records:false,leaderboard:false}),{accessMode:"read only",isolationLevel:"repeatable read"});
      return {snapshot,board:projectBetBoard(snapshot),options};
    }finally{client.query=query;}
  }
  try {
    const current=await measure(f.userId,"open");
    const history=Array.from({length:100},()=>({matchId:randomUUID(),marketId:randomUUID(),optionId:randomUUID(),settlementId:randomUUID()}));
    await f.db.insert(schema.matches).values(history.map((h,i)=>({id:h.matchId,seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:original.majorStageRunId,ownership:"major_stage" as const,managedKey:`open-history-${i}`,round:1,format:"bo3" as const,status:"finished" as const,scoreA:2,scoreB:0})));
    await f.db.insert(schema.betMarkets).values(history.map(h=>({...market,id:h.marketId,matchId:h.matchId,marketKey:`open-history/${h.matchId}`,subject:market.subject,lockedAt:new Date()})));
    await f.db.insert(schema.betOptions).values(history.flatMap(h=>choices.map((o,i)=>({...o,id:i===0?h.optionId:randomUUID(),marketId:h.marketId}))));
    await f.db.insert(schema.betSettlements).values(history.map(h=>({id:h.settlementId,marketId:h.marketId,revision:1,state:"settled" as const,fingerprint:"history",winningOptionIds:[h.optionId]})));
    await f.db.insert(schema.betStakes).values(history.map(h=>({seasonId:f.seasonId,accountId:account.id,marketId:h.marketId,optionId:h.optionId,amount:BigInt(1),requestId:randomUUID()})));
    await f.db.insert(schema.betLedger).values(history.map(h=>({seasonId:f.seasonId,accountId:account.id,kind:"settlement" as const,source:`settlement/${h.settlementId}`,amount:BigInt(1),profit:BigInt(0)})));
    const broad=await measure(f.userId),open=await measure(f.userId,"open");
    expect(broad.snapshot.all).toHaveLength(current.snapshot.all.length+100);
    expect(open.options).toEqual(current.options);
    expect(open.board.markets).toEqual(broad.board.markets.filter(m=>["open","locked"].includes(m.state)));
    expect(open.snapshot.myStakes).toEqual(current.snapshot.myStakes);
    expect(open.snapshot.latestSettlements).toEqual(current.snapshot.latestSettlements);
    expect(open.snapshot.myPayouts).toEqual(current.snapshot.myPayouts);
    console.info("BET_OPEN_CANDIDATES",JSON.stringify({fixture:"one current match + 100 settled matches",current:current.options,oldUnfiltered:broad.options,open:open.options,unit:"returned option rows and UTF-8 JSON estimate of driver rows; not wire/provider egress"}));

    // Revision, rather than creation time or any historical terminal state,
    // owns reopening. Keep a finished match with no settlement as locked too.
    await f.db.insert(schema.betSettlements).values([
      {marketId:history[0]!.marketId,revision:2,state:"pending",fingerprint:"reopened",winningOptionIds:[],createdAt:new Date("2000-01-01")},
      {marketId:history[1]!.marketId,revision:2,state:"refunded",fingerprint:"refunded",winningOptionIds:[]},
    ]);
    const unsettledMarketId=randomUUID(),finishedMatchId=randomUUID();
    await f.db.insert(schema.matches).values({id:finishedMatchId,seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:original.majorStageRunId,ownership:"major_stage",managedKey:"finished-unsettled",round:1,format:"bo3",status:"finished",scoreA:2,scoreB:0});
    await f.db.insert(schema.betMarkets).values({...market,id:unsettledMarketId,matchId:finishedMatchId,marketKey:"finished-unsettled",subject:market.subject});
    await f.db.insert(schema.betOptions).values(choices.map(o=>({...o,id:randomUUID(),marketId:unsettledMarketId})));
    await f.db.update(schema.matches).set({entryAId:f.entryIds[1]!,entryBId:f.entryIds[0]!}).where(eq(schema.matches.id,history[2]!.matchId));
    for(const userId of [f.userId,null]) {
      const full=await measure(userId),next=await measure(userId,"open");
      expect(next.board).toEqual({...full.board,markets:full.board.markets.filter(m=>["open","locked"].includes(m.state))});
      for(const id of [history[0]!.marketId,unsettledMarketId])expect(next.board.markets.find(m=>m.id===id)).toMatchObject({state:"locked",canStake:false});
      expect(next.snapshot.latestSettlements.find(s=>s.marketId===history[0]!.marketId)?.revision).toBe(2);
      expect(next.board.markets.some(m=>m.id===history[1]!.marketId)).toBe(false);
      for(const view of ["mine","settled","event"]) {
        const scoped=await measure(userId,view);
        expect(scoped.board).toEqual({...full.board,markets:full.board.markets.filter(m=>view==="mine"?!!m.mine:view==="settled"?["settled","refunded"].includes(m.state):m.matchId===null)});
      }
      const explicit=await measure(userId,undefined,history[2]!.matchId);
      expect(explicit.board.markets).toEqual(full.board.markets.filter(m=>m.matchId===history[2]!.matchId));
      expect(explicit.board.markets[0]?.mine?.payout).toBe(userId?"1":undefined);
      const scopedOpen=await measure(userId,"open",history[0]!.matchId);
      expect(scopedOpen.board.markets.map(m=>m.id)).toEqual([history[0]!.marketId]);
      for(const rows of [next.snapshot.allOptions,next.snapshot.myStakes,next.snapshot.latestSettlements])expect(rows.every(row=>next.snapshot.all.some(m=>m.id===row.marketId))).toBe(true);
      expect(next.snapshot.myPayouts.every(row=>next.snapshot.latestSettlements.some(s=>row.source===`settlement/${s.id}`))).toBe(true);
    }
  }finally{client.release();}
}));

// Real PG results protect scope/privacy/rank semantics and measure returned data.
// The baseline preserves the former two full-fact entrypoints using current rule
// owners. It is conservative: common SQL projection improvements benefit it too.
it("bounds match reads, shares board facts, and preserves money/rank/history against full reads",async()=>fixture(async f=>{
  const original=(await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)}))!;
  const ids=Array.from({length:20},()=>randomUUID());
  await f.db.insert(schema.users).values(ids.map(id=>({id,email:`${id}@example.test`,displayName:"读量样本",emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration" as const})));
  const matchIds=[f.matchId,...Array.from({length:11},()=>randomUUID())];
  await f.db.insert(schema.matches).values(matchIds.slice(1).map((id,i)=>({id,seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:original.majorStageRunId,ownership:"major_stage" as const,managedKey:`read-${i}`,round:1,format:"bo3" as const})));
  await f.db.insert(schema.freePredictionChoices).values(matchIds.flatMap(matchId=>ids.map((userId,i)=>({seasonId:f.seasonId,matchId,userId,kind:"result" as const,selection:[f.entryIds[i%2]!],subject:{entryIds:f.entryIds as [string,string],runId:original.majorStageRunId!,format:"bo3" as const,mapPool:[]}}))));
  await f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"result",selection:[f.entryIds[0]!],requestId:randomUUID()}));
  const account=(await f.db.query.betAccounts.findFirst({where:eq(schema.betAccounts.userId,f.userId)}))!;
  await f.db.insert(schema.betLedger).values(Array.from({length:120},(_,i)=>({seasonId:f.seasonId,accountId:account.id,kind:"stage" as const,source:`stage/read-fixture-${i}`,amount:BigInt(1),profit:BigInt(0)})));

  const client=await f.db.$client.connect();
  const measuredDb=drizzle(client,{schema});
  async function measure<T>(operation:(tx:TxDb)=>Promise<T>,readOnly=true) {
    const footprint={statements:0,queries:0,rows:0,jsonBytes:0};
    const query=client.query;
    client.query=((...args:unknown[])=>{
      const result=Reflect.apply(query,client,args);
      return Promise.resolve(result).then(value=>{
        footprint.statements++;
        if(value.command==="SELECT") { footprint.queries++;footprint.rows+=value.rows.length;footprint.jsonBytes+=Buffer.byteLength(JSON.stringify(value.rows)); }
        return value;
      });
    }) as typeof client.query;
    try {return {value:await measuredDb.transaction(operation,{accessMode:readOnly?"read only":"read write",isolationLevel:"repeatable read"}),...footprint};}
    finally {client.query=query;}
  }
  try {
    const full=await measure(async tx=>({bet:await betBoard(tx,f.seasonId,f.userId),free:await readFreePredictionBoard(tx,f.seasonId,f.userId,{facts:await loadBetFacts(tx,f.seasonId)})}));
    const unified=await measure(tx=>readUnifiedBetBoard(tx,f.seasonId,f.userId));
    expect(unified.value.free).toEqual(full.value.free);
    expect(unified.value.bet).toMatchObject({balance:full.value.bet.balance,profit:full.value.bet.profit,rank:full.value.bet.rank,markets:full.value.bet.markets.filter(m=>m.matchId!==null),records:[],leaderboard:[]});
    expect(unified.queries).toBeLessThan(full.queries);
    // The removable history has 120 fixture rows. Absolute savings depend on
    // the event's vote/roster/market composition, so assert that work is removed.
    expect(unified.rows).toBeLessThanOrEqual(full.rows-120);
    expect(unified.jsonBytes).toBeLessThan(full.jsonBytes);
    const single=await measure(tx=>readFreeMatchSupport(tx,f.seasonId,f.matchId));
    const oldSingle=await measure(async tx=>(await readFreePredictionBoard(tx,f.seasonId,null,{facts:await loadBetFacts(tx,f.seasonId)})).matches.find(m=>m.matchId===f.matchId)?.result.support??null);
    expect(single.value).toEqual(oldSingle.value);
    expect(single.rows).toBeLessThan(oldSingle.rows/2);
    expect(single.jsonBytes).toBeLessThan(oldSingle.jsonBytes/2);
    console.info("BET_READ_FOOTPRINT",JSON.stringify({baseline:"two full-fact reads using current rule owners",full:{queries:full.queries,rows:full.rows,jsonBytes:full.jsonBytes},unified:{queries:unified.queries,rows:unified.rows,jsonBytes:unified.jsonBytes},oldSingle:{queries:oldSingle.queries,rows:oldSingle.rows,jsonBytes:oldSingle.jsonBytes},single:{queries:single.queries,rows:single.rows,jsonBytes:single.jsonBytes}}));
    const pages=[];
    for(let page=0;page<3;page++)pages.push((await measure(tx=>readUnifiedBetBoard(tx,f.seasonId,f.userId,{view:"records",recordsPage:page}))).value.bet);
    expect(pages.flatMap(page=>page.records)).toEqual(full.value.bet.records);
    expect(pages.map(page=>page.recordsHasMore)).toEqual([true,true,false]);
    const cursorPages=[pages[0]!];
    for(let page=1;page<3;page++)cursorPages.push((await measure(tx=>readUnifiedBetBoard(tx,f.seasonId,f.userId,{view:"records",recordsPage:page,recordsCursor:cursorPages[page-1]!.recordsNextCursor}))).value.bet);
    expect(cursorPages.flatMap(page=>page.records)).toEqual(full.value.bet.records);
    const broad=await measure(tx=>betBoard(tx,f.seasonId,f.userId));
    const narrow=await measure(tx=>readUnifiedBetBoard(tx,f.seasonId,f.userId,{view:"records",recordsPage:0}));
    expect(narrow.value.bet.records).toEqual(broad.value.records.slice(0,50));
    expect(narrow.value.bet).toMatchObject({balance:broad.value.balance,profit:broad.value.profit,rank:broad.value.rank,markets:[],matches:[]});
    for(const view of ["mine","event","settled","leaderboard"]){
      const narrowed=await measure(tx=>readUnifiedBetBoard(tx,f.seasonId,f.userId,{view}));
      expect(narrowed.value.bet).toMatchObject({balance:full.value.bet.balance,profit:full.value.bet.profit,rank:full.value.bet.rank});
      const expected=full.value.bet.markets.filter(m=>view==="mine"?!!m.mine:view==="event"?m.matchId===null:view==="settled"?["settled","refunded"].includes(m.state):false);
      expect(narrowed.value.bet.markets).toEqual(expected);
    }
    const snap=await measuredDb.transaction(tx=>readBetBoardSnapshot(tx,f.seasonId,f.userId),{accessMode:"read only",isolationLevel:"repeatable read"});
    expect(projectBetBoard(snap)).toEqual(full.value.bet);

    expect((await measure(tx=>readUnifiedBetBoard(tx,f.seasonId,null,{view:"records",recordsPage:0}))).value.bet.records).toEqual([]);
    // Canonical alias preference and subject changes must match the original rule owner.
    await f.db.update(schema.users).set({status:"merged",mergedIntoUserId:ids[1]!,mergedAt:new Date()}).where(eq(schema.users.id,ids[0]!));
    expect((await measure(tx=>readFreeMatchSupport(tx,f.seasonId,f.matchId))).value).toMatchObject({total:20,counts:[10,10]});
    await f.db.update(schema.matches).set({status:"cancelled"}).where(eq(schema.matches.id,f.matchId));
    expect((await measure(tx=>readFreeMatchSupport(tx,f.seasonId,f.matchId))).value).toMatchObject({total:0,counts:[0,0]});
    expect((await measure(tx=>readFreeMatchSupport(tx,f.seasonId,randomUUID()))).value).toBeNull();
    await expect(measure(tx=>readFreeMatchSupport(tx,randomUUID(),f.matchId))).rejects.toThrow("赛事不存在");

  } finally {client.release();}
}));

// Real SQL protects bigint precision and distinct participants across options.
it("aggregates option pools and market participants in one snapshot without double-counting accounts", async () => fixture(async f => {
  const board = await f.db.transaction(tx => betBoard(tx, f.seasonId, f.userId));
  const market = board.markets.find(row => row.type === "match_winner")!;
  const accounts = await f.db.select().from(schema.betAccounts).where(eq(schema.betAccounts.seasonId, f.seasonId));
  const viewer = accounts.find(row => row.userId === f.userId)!;
  const other = accounts.find(row => row.userId === f.otherId)!;
  const large = BigInt("9007199254740993");
  await f.db.insert(schema.betStakes).values([
    { seasonId: f.seasonId, marketId: market.id, accountId: viewer.id, optionId: market.options[0]!.id, amount: large, requestId: randomUUID() },
    { seasonId: f.seasonId, marketId: market.id, accountId: viewer.id, optionId: market.options[1]!.id, amount: BigInt(10), requestId: randomUUID() },
    { seasonId: f.seasonId, marketId: market.id, accountId: other.id, optionId: market.options[0]!.id, amount: BigInt(20), requestId: randomUUID() },
  ]);
  let reads = 0;
  const measured = drizzle(f.db.$client, { schema, logger: { logQuery: query => { if (query.startsWith("select")) reads++; } } });
  const pools = await measured.transaction(tx => readBetPools(tx, f.seasonId, { matchId: f.matchId }));
  expect(reads).toBe(1);
  expect(pools.pool.find(row => row.optionId === market.options[0]!.id)?.amount).toBe((large + BigInt(20)).toString());
  expect(pools.pool.find(row => row.optionId === market.options[1]!.id)?.amount).toBe("10");
  expect(pools.counts.find(row => row.marketId === market.id)?.count).toBe(2);
  expect(await f.db.transaction(tx => readBetPools(tx, f.seasonId, { matchId: randomUUID() }))).toEqual({ pool: [], counts: [] });
  expect(await f.db.transaction(tx => readBetPools(tx, randomUUID()))).toEqual({ pool: [], counts: [] });
}));

// Real persistence proves read-only unknown recovery and request ownership, never mock commit.
it("confirms an unknown stake only by its original viewer and payload, without replaying money",async()=>fixture(async f=>{
  const board=await f.db.transaction(tx=>betBoard(tx,f.seasonId,f.userId));
  const market=board.markets.find(m=>m.type==="match_winner")!;
  const input={seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:market.options[0]!.id,amount:"25",requestId:randomUUID()};
  expect(await readBetStakeReceipt(f.db,input)).toEqual({status:"unconfirmed"});
  await f.db.transaction(tx=>stakeBetInTx(tx,input));
  for(let run=0;run<2;run++)expect(await readBetStakeReceipt(f.db,input)).toEqual({status:"committed",amount:"25"});
  expect(await readBetStakeReceipt(f.db,{...input,userId:f.otherId})).toEqual({status:"unconfirmed"});
  await expect(readBetStakeReceipt(f.db,{...input,amount:"26"})).rejects.toThrow("请求标识与投入内容不一致");
  const after=await f.db.transaction(tx=>betBoard(tx,f.seasonId,f.userId));
  expect(after.balance).toBe((BigInt(board.balance)-BigInt(25)).toString());
}));
