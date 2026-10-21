import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { TxDb } from "@/db/client";
import { fixture } from "./harness/bet-fixture";
import { betBoard } from "@/lib/bet/data";
import { loadBetFacts } from "@/lib/bet/facts";
import { readUnifiedBetBoard } from "@/lib/bet/board-read";
import { readFreePredictionBoard, readFreeMatchSupport } from "@/lib/free-predictions/data";
import { submitFreePredictionInTx } from "@/lib/free-predictions/service";

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
  async function measure<T>(operation:(tx:TxDb)=>Promise<T>) {
    const footprint={queries:0,rows:0,jsonBytes:0};
    const query=client.query;
    client.query=((...args:unknown[])=>{
      const result=Reflect.apply(query,client,args);
      return Promise.resolve(result).then(value=>{
        if(value.command==="SELECT") { footprint.queries++;footprint.rows+=value.rows.length;footprint.jsonBytes+=Buffer.byteLength(JSON.stringify(value.rows)); }
        return value;
      });
    }) as typeof client.query;
    try {return {value:await measuredDb.transaction(operation,{accessMode:"read only",isolationLevel:"repeatable read"}),...footprint};}
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
