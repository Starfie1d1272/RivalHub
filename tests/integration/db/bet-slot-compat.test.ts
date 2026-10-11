import { randomUUID } from "node:crypto";
import { and,eq,sql } from "drizzle-orm";
import { describe,it,expect,vi } from "vitest";
import * as schema from "@/db/schema";
import { fixture,read } from "./harness/bet-fixture";
import { lockBetProgram,reconcileBetInTx,stakeBetInTx } from "@/lib/bet/service";

// Exercise the compatible v1 publisher after v2 subjects exist, including fallback
// settlement and duplicate publication. The feature release keeps this v1 path.
vi.mock("@/lib/bet/catalog-contract.json",()=>({default:{readerVersion:2,publisherVersion:1}}));

async function slot(f:Parameters<Parameters<typeof fixture>[0]>[0],mapOrder:number) {
  const match=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
  const [market]=await f.db.insert(schema.betMarkets).values({seasonId:f.seasonId,matchId:f.matchId,type:"total_rounds",line:43,marketKey:`compat/${f.matchId}/${mapOrder}`,subject:{kind:"map_slot",entryIds:[f.entryIds[0]!,f.entryIds[1]!],runId:match!.majorStageRunId!,format:"bo3",mapOrder}}).returning();
  const options=await f.db.insert(schema.betOptions).values(["over","under"].map((key,position)=>({marketId:market!.id,key,label:key,position}))).returning();
  return {market:market!,options};
}
const reconcile=(f:Parameters<Parameters<typeof fixture>[0]>[0])=>f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});

describe("BET reader-first catalog upgrade",()=>{
  it("v1 publisher does not create slots, reads/stakes v2 slots, settles by map not series and never duplicates their pool",async()=>fixture(async f=>{
    expect((await f.db.select().from(schema.betMarkets)).some(m=>m.subject.kind==="map_slot")).toBe(false);
    const {market,options}=await slot(f,1);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({context:"第1图 · 地图待定",state:"open",canStake:true});
    for(const [userId,optionId,amount] of [[f.userId,options[0]!.id,"100"],[f.otherId,options[1]!.id,"200"]])await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:userId!,marketId:market.id,optionId:optionId!,amount:amount!,requestId:randomUUID()}));
    const [map]=await f.db.insert(schema.matchMaps).values({matchId:f.matchId,mapOrder:1,mapName:"de_nuke"}).returning();
    await f.db.insert(schema.matchVetoSessions).values({matchId:f.matchId,startedAt:new Date(),completedAt:new Date(),mapPoolSnapshot:["de_nuke","de_inferno","de_mirage"]});
    await reconcile(f);
    expect((await f.db.select().from(schema.betMarkets)).filter(m=>m.matchId===f.matchId && m.type==="total_rounds")).toHaveLength(1);
    await f.db.update(schema.matches).set({status:"in_progress",gameplayStartedAt:new Date()}).where(eq(schema.matches.id,f.matchId));
    await f.db.update(schema.matchMaps).set({startedAt:new Date(),completedAt:new Date(),scoreA:16,scoreB:14}).where(eq(schema.matchMaps.id,map!.id));
    await reconcile(f);await reconcile(f);
    const board=await read(f.db,f.seasonId,f.userId);
    expect(board.markets.find(m=>m.id===market.id)).toMatchObject({state:"settled",mine:{amount:"100",payout:"300"}});
    // Series still has no final score: a generic match fallback would remain pending.
    expect(board.balance).toBe("1200");
    expect(await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)})).toMatchObject({status:"in_progress",scoreA:null});
    await f.db.update(schema.matchMaps).set({scoreA:13,scoreB:5}).where(eq(schema.matchMaps.id,map!.id));await reconcile(f);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({state:"settled",mine:{payout:"0"}});
    expect((await read(f.db,f.seasonId,f.otherId)).balance).toBe("1100");
  }));

  it("outbox closes the unplayed slot at committed 2-0, keeps funds pending through correction and refunds only at finalization",async()=>fixture(async f=>{
    const {market,options}=await slot(f,3);
    await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:options[0]!.id,amount:"100",requestId:randomUUID()}));
    await f.db.update(schema.matches).set({status:"in_progress",gameplayStartedAt:new Date()}).where(eq(schema.matches.id,f.matchId));
    const maps=await f.db.insert(schema.matchMaps).values([1,2].map(mapOrder=>({matchId:f.matchId,mapOrder,mapName:mapOrder===1?"de_nuke":"de_inferno",startedAt:new Date(),completedAt:new Date(),scoreA:13,scoreB:7}))).returning();
    // No worker is needed to close admission, and official terminal status is absent.
    const locked=await f.db.query.betMarkets.findFirst({where:eq(schema.betMarkets.id,market.id)});
    expect(locked!.lockedAt).not.toBeNull();expect(locked!.voidedAt).toBeNull();
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({state:"locked",canStake:false,mine:{payout:null}});
    await expect(f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.otherId,marketId:market.id,optionId:options[1]!.id,amount:"50",requestId:randomUUID()}))).rejects.toThrow(/锁定/);
    await reconcile(f);
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe("900");
    expect(await f.db.query.betSettlements.findFirst({where:eq(schema.betSettlements.marketId,market.id)})).toMatchObject({state:"pending"});
    await f.db.update(schema.matchMaps).set({scoreA:7,scoreB:13}).where(eq(schema.matchMaps.id,maps[1]!.id));await reconcile(f);
    expect((await f.db.query.betMarkets.findFirst({where:eq(schema.betMarkets.id,market.id)}))!.lockedAt).toEqual(locked!.lockedAt);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({state:"locked",mine:{payout:null}});
    await f.db.update(schema.matchMaps).set({scoreA:13,scoreB:7}).where(eq(schema.matchMaps.id,maps[1]!.id));
    await f.db.update(schema.matches).set({status:"finished",scoreA:2,scoreB:0}).where(eq(schema.matches.id,f.matchId));await reconcile(f);await reconcile(f);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({state:"refunded",mine:{payout:"100"}});
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe("1000");
    const account=await f.db.query.betAccounts.findFirst({where:and(eq(schema.betAccounts.seasonId,f.seasonId),eq(schema.betAccounts.userId,f.userId))});
    expect((await f.db.execute(sql`select count(*)::int as count from bet_ledger where account_id=${account!.id} and kind='settlement'`)).rows[0]?.count).toBe(1);
  }));
  it("a concurrent stake waits for the official clinch transaction and rejects after commit",async()=>fixture(async f=>{
    const {market,options}=await slot(f,3);
    const maps=await f.db.insert(schema.matchMaps).values([
      {matchId:f.matchId,mapOrder:1,mapName:"de_nuke",completedAt:new Date(),scoreA:13,scoreB:7},
      {matchId:f.matchId,mapOrder:2,mapName:"de_inferno"},
    ]).returning();
    let ready!:()=>void, release!:()=>void, reportPid!:(pid:number)=>void;
    const written=new Promise<void>(resolve=>{ready=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const pidReady=new Promise<number>(resolve=>{reportPid=resolve;});
    const official=f.db.transaction(async tx=>{
      await tx.execute(sql`select id from matches where id=${f.matchId} for update`);
      await tx.update(schema.matchMaps).set({completedAt:new Date(),scoreA:13,scoreB:7}).where(eq(schema.matchMaps.id,maps[1]!.id));
      ready();await gate;
    });
    let stake:Promise<unknown>|undefined;
    try {
      await written;
      stake=f.db.transaction(async tx=>{
        const result=await tx.execute(sql`select pg_backend_pid() as pid`);reportPid(Number(result.rows[0]!.pid));
        return stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:options[0]!.id,amount:"100",requestId:randomUUID()});
      }).then(()=>null,error=>error);
      const pid=await pidReady;
      await expect.poll(async()=>{
        const result=await f.db.execute(sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`);
        return result.rows[0]!.blocked;
      }).toBe(true);
    } finally {release();await official;}
    expect(await stake).toMatchObject({message:expect.stringMatching(/锁定/)});
    expect(await f.db.select().from(schema.betStakes).where(eq(schema.betStakes.marketId,market.id))).toHaveLength(0);
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe("1000");
  }));

});
