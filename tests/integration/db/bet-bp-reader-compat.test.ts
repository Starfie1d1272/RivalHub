import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { lockBetProgram, reconcileBetInTx, stakeBetInTx } from "@/lib/bet/service";
import { fixture, read } from "./harness/bet-fixture";

// Persisted N+1 financial facts are intentionally seeded before the actual N
// worker runs. In the reader-only release this is the real backward worker;
// future publishers must preserve the same invariant. No capability or service
// is mocked or enabled.
// A changed identity must refund old terms, never revert this match to ordered BP.
describe("BO3 presence backward worker compatibility",()=>{
  for(const correction of ["entries","run","pool"] as const) it(`retains new BP rules after ${correction} correction with the canonical worker`,async()=>fixture(async f=>{
    const original=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
    const pool=["de_ancient","de_anubis","de_dust2","de_inferno","de_mirage","de_nuke","de_overpass"];
    const [match]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:original!.majorStageRunId,ownership:"major_stage",managedKey:randomUUID(),format:"bo3"}).returning();
    const [market]=await f.db.insert(schema.betMarkets).values({seasonId:f.seasonId,matchId:match!.id,type:"veto_present",marketKey:`future-presence/${randomUUID()}`,subject:{kind:"match",entryIds:[f.entryIds[0]!,f.entryIds[1]!],runId:original!.majorStageRunId!,format:"bo3",mapPool:pool}}).returning();
    const options=await f.db.insert(schema.betOptions).values(pool.map((key,position)=>({marketId:market!.id,key,label:key,position}))).returning();
    const reconcile=()=>f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market!.id,optionId:options[0]!.id,amount:"100",requestId:randomUUID()}));
    await reconcile();
    expect((await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,match!.id))).filter(m=>m.type.startsWith("veto_"))).toEqual([market]);
    if(correction==="entries") await f.db.update(schema.matches).set({entryAId:f.entryIds[1]!,entryBId:f.entryIds[0]!}).where(eq(schema.matches.id,match!.id));
    else if(correction==="pool") await f.db.insert(schema.matchVetoSessions).values({matchId:match!.id,mapPoolSnapshot:[...pool.slice(0,6),"de_cache"]});
    else {
      const run=await f.db.query.majorStageRuns.findFirst({where:eq(schema.majorStageRuns.id,original!.majorStageRunId!)});
      const [replacement]=await f.db.insert(schema.majorStageRuns).values({seasonId:f.seasonId,stageKey:"stage2",startedAt:run!.startedAt,startedBy:"test",ruleSnapshot:run!.ruleSnapshot}).returning();
      await f.db.update(schema.matches).set({majorStageRunId:replacement!.id,stage:"stage2"}).where(eq(schema.matches.id,match!.id));
    }
    await reconcile();await reconcile();
    const bp=(await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,match!.id))).filter(m=>m.type.startsWith("veto_"));
    expect(bp.map(m=>m.type)).toEqual(["veto_present"]);
    expect(bp[0]!.subject).toEqual(market!.subject);
    expect(await f.db.select().from(schema.betOptions).where(eq(schema.betOptions.marketId,market!.id))).toEqual(options);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market!.id)).toMatchObject({state:"refunded",canStake:false,mine:{amount:"100",payout:"100",profit:"0"}});
    expect((await f.db.execute(sql`select sum(amount)::text as amount, sum(profit)::text as profit from bet_ledger where season_id=${f.seasonId}`)).rows[0]).toEqual({amount:"2000",profit:"0"});
    const checkpoint=await f.db.select().from(schema.betLedger).where(eq(schema.betLedger.seasonId,f.seasonId));
    await reconcile();
    expect(await f.db.select().from(schema.betLedger).where(eq(schema.betLedger.seasonId,f.seasonId))).toEqual(checkpoint);
  }));
});
