import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { TxDb } from "@/db/client";
import { fixture } from "./harness/bet-fixture";
import { readUnifiedBetBoard } from "@/lib/bet/board-read";
import { readBetPublicStats } from "@/lib/bet/public-stats-read";
import { operateBetInTx, stakeBetInTx } from "@/lib/bet/service";
import { submitFreePredictionInTx } from "@/lib/free-predictions/service";

// Injecting one aggregate snapshot proves data isolation and reduced PG work;
// actual Next cache hits, expiration and tag invalidation require runtime evidence.
it("shares only aggregates while viewer money, choices and admission remain fresh",async()=>fixture(async f=>{
  const original=(await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)}))!;
  const spectators=Array.from({length:100},()=>randomUUID());
  await f.db.insert(schema.users).values(spectators.map(id=>({id,email:`${id}@example.test`,emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration" as const})));
  await f.db.insert(schema.freePredictionChoices).values(spectators.map((userId,i)=>({seasonId:f.seasonId,matchId:f.matchId,userId,kind:"result" as const,selection:[f.entryIds[i%2]!],subject:{entryIds:f.entryIds as [string,string],runId:original.majorStageRunId!,format:"bo3" as const,mapPool:[]}})));
  const read=(userId:string|null)=>f.db.transaction(tx=>readUnifiedBetBoard(tx,f.seasonId,userId),{accessMode:"read only",isolationLevel:"repeatable read"});
  const market=(await read(f.userId)).bet.markets.find(m=>m.type==="match_winner" && m.matchId===f.matchId)!;
  for (const [userId,option,amount] of [[f.userId,0,"100"],[f.otherId,1,"200"]] as const) {
    await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId,marketId:market.id,optionId:market.options[option]!.id,amount,requestId:randomUUID()}));
    await f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId,kind:"result",selection:[f.entryIds[option]!],requestId:randomUUID()}));
  }
  const snapshot=await f.db.transaction(tx=>readBetPublicStats(tx,f.seasonId,{includeEvent:false,includeFree:true}),{accessMode:"read only",isolationLevel:"repeatable read"});
  const serialized=JSON.stringify(snapshot);
  for (const id of [f.userId,f.otherId,...spectators]) expect(serialized).not.toContain(id);
  for (const key of ["userId","accountId","selection","balance","records","mine"]) expect(serialized).not.toContain(`"${key}"`);

  const client=await f.db.$client.connect();
  const measuredDb=drizzle(client,{schema});
  async function measure<T>(operation:(tx:TxDb)=>Promise<T>) {
    const footprint={queries:0,rows:0,jsonBytes:0};
    const choices:{text:string;rows:number}[]=[];
    const query=client.query;
    client.query=((...args:unknown[])=>{
      const config=args[0] as string | {text:string};
      const text=typeof config==="string"?config:config.text;
      return Promise.resolve(Reflect.apply(query,client,args)).then(value=>{
        if(value.command==="SELECT") {
          footprint.queries++;footprint.rows+=value.rows.length;footprint.jsonBytes+=Buffer.byteLength(JSON.stringify(value.rows));
          if(text.includes('from "free_prediction_choices"'))choices.push({text,rows:value.rows.length});
        }
        return value;
      });
    }) as typeof client.query;
    try {return {value:await measuredDb.transaction(operation,{accessMode:"read only",isolationLevel:"repeatable read"}),choices,...footprint};}
    finally {client.query=query;}
  }
  try {
    const report=[];
    for (const userId of [f.userId,f.otherId,null]) {
      const baseline=await measure(tx=>readUnifiedBetBoard(tx,f.seasonId,userId));
      const reused=await measure(tx=>readUnifiedBetBoard(tx,f.seasonId,userId,{},snapshot));
      expect(reused.value).toEqual(baseline.value);
      expect(reused.rows).toBeLessThan(baseline.rows-90);
      expect(reused.jsonBytes).toBeLessThan(baseline.jsonBytes);
      expect(reused.queries).toBeLessThanOrEqual(baseline.queries);
      if(userId) {
        expect(reused.choices).toHaveLength(1);
        expect(reused.choices[0]!.rows).toBe(1);
        expect(reused.choices[0]!.text.split(" where ")[1]).toMatch(/"user_id" in /);
      } else {
        expect(reused.choices).toEqual([]);
        expect(reused.queries).toBeLessThan(baseline.queries);
        expect(reused.value.bet.markets.every(m=>m.mine===null && !m.canStake)).toBe(true);
        expect(reused.value.free.matches.every(m=>m.result.mine===null && m.bp.mine===null)).toBe(true);
      }
      report.push({viewer:userId?"authenticated":"anonymous",baseline:{queries:baseline.queries,rows:baseline.rows,jsonBytes:baseline.jsonBytes},reused:{queries:reused.queries,rows:reused.rows,jsonBytes:reused.jsonBytes}});
    }
    console.info("BET_PUBLIC_STATS_REUSE",JSON.stringify(report));
    const reusedRead=()=>f.db.transaction(tx=>readUnifiedBetBoard(tx,f.seasonId,f.userId,{},snapshot),{accessMode:"read only",isolationLevel:"repeatable read"});
    await f.db.transaction(tx=>operateBetInTx(tx,{seasonId:f.seasonId,actorId:f.userId,operation:"pause"}));
    expect(await reusedRead()).toEqual(await read(f.userId));
    expect((await reusedRead()).bet.markets.every(m=>!m.canStake)).toBe(true);
    await expect(f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:market.options[0]!.id,amount:"1",requestId:randomUUID()}))).rejects.toThrow();
    await f.db.transaction(tx=>operateBetInTx(tx,{seasonId:f.seasonId,actorId:f.userId,operation:"resume"}));
    await f.db.transaction(tx=>operateBetInTx(tx,{seasonId:f.seasonId,actorId:f.userId,operation:"close",marketId:market.id}));
    expect(await reusedRead()).toEqual(await read(f.userId));
    expect((await reusedRead()).bet.markets.find(m=>m.id===market.id)).toMatchObject({state:"locked",canStake:false});
    await expect(f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:market.options[0]!.id,amount:"1",requestId:randomUUID()}))).rejects.toThrow();
    await f.db.insert(schema.freePredictionLocks).values({seasonId:f.seasonId,matchId:f.matchId,resultLockedAt:new Date(),bpLockedAt:new Date()}).onConflictDoUpdate({target:schema.freePredictionLocks.matchId,set:{resultLockedAt:new Date(),bpLockedAt:new Date()}});
    expect((await reusedRead()).free.matches[0]).toMatchObject({result:{locked:true,canSubmit:false},bp:{locked:true,canSubmit:false}});
    // Retain the old snapshot to exercise fresh-subject fallback after correction.
    await f.db.update(schema.matches).set({entryAId:f.entryIds[1]!,entryBId:f.entryIds[0]!}).where(eq(schema.matches.id,f.matchId));
    expect(await reusedRead()).toEqual(await read(f.userId));
    expect((await reusedRead()).free.matches[0]!.result.support.total).toBe(0);
    await f.db.update(schema.matches).set({status:"cancelled"}).where(eq(schema.matches.id,f.matchId));
    expect(await reusedRead()).toEqual(await read(f.userId));
    expect((await reusedRead()).free.matches[0]).toMatchObject({result:{canSubmit:false,support:{total:0}},bp:{canSubmit:false,support:{total:0}}});
  } finally {client.release();}
}));

it("keeps multilevel alias choices, canonical preference and latest alias selection in private reads",async()=>fixture(async f=>{
  const original=(await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)}))!;
  const aliasA=randomUUID(),aliasB=randomUUID(),aliasC=randomUUID();
  await f.db.insert(schema.users).values([aliasA,aliasB,aliasC].map(id=>({id,email:`${id}@example.test`}))) ;
  await f.db.update(schema.users).set({status:"merged",mergedIntoUserId:f.userId,mergedAt:new Date()}).where(eq(schema.users.id,aliasB));
  await f.db.update(schema.users).set({status:"merged",mergedIntoUserId:aliasB,mergedAt:new Date()}).where(eq(schema.users.id,aliasA));
  await f.db.update(schema.users).set({status:"merged",mergedIntoUserId:f.otherId,mergedAt:new Date()}).where(eq(schema.users.id,aliasC));
  const subject={entryIds:f.entryIds as [string,string],runId:original.majorStageRunId!,format:"bo3" as const,mapPool:[]};
  await f.db.insert(schema.freePredictionChoices).values([
    {userId:f.userId,kind:"result" as const,selection:[f.entryIds[0]!],updatedAt:new Date("2026-01-01")},
    {userId:aliasA,kind:"result" as const,selection:[f.entryIds[1]!],updatedAt:new Date("2026-01-03")},
    {userId:aliasB,kind:"result" as const,selection:[f.entryIds[1]!],updatedAt:new Date("2026-01-02")},
    {userId:aliasA,kind:"bp" as const,selection:["de_mirage","de_inferno","de_nuke"],updatedAt:new Date("2026-01-03")},
    {userId:aliasB,kind:"bp" as const,selection:["de_ancient","de_anubis","de_dust2"],updatedAt:new Date("2026-01-02")},
    {userId:aliasC,kind:"result" as const,selection:[f.entryIds[1]!],updatedAt:new Date("2026-01-02")},
  ].map(row=>({...row,seasonId:f.seasonId,matchId:f.matchId,subject})));
  const snapshot=await f.db.transaction(tx=>readBetPublicStats(tx,f.seasonId,{includeEvent:false,includeFree:true}));
  for(const userId of [f.userId,f.otherId,null]) {
    const baseline=await f.db.transaction(tx=>readUnifiedBetBoard(tx,f.seasonId,userId));
    const reused=await f.db.transaction(tx=>readUnifiedBetBoard(tx,f.seasonId,userId,{},snapshot));
    expect(reused).toEqual(baseline);
    expect(reused.free.matches[0]!.result.support.total).toBe(2);
    if(userId===f.userId)expect(reused.free.matches[0]).toMatchObject({result:{mine:f.entryIds[0]},bp:{mine:["de_mirage","de_inferno","de_nuke"]}});
    if(userId===f.otherId)expect(reused.free.matches[0]).toMatchObject({result:{mine:f.entryIds[1]},bp:{mine:null}});
  }
}));
