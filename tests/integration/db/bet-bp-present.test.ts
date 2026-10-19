import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { joinBetInTx, lockBetProgram, reconcileBetInTx, runBetReconciliationJob, stakeBetInTx } from "@/lib/bet/service";
import { fixture, read } from "./harness/bet-fixture";

type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
const reconcile=(f:Fixture)=>f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
const pool=["de_ancient","de_anubis","de_dust2","de_inferno","de_mirage","de_nuke","de_overpass"];
async function seed(f:Fixture) {
  const original=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
  const [match]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:original!.majorStageRunId,ownership:"major_stage",managedKey:randomUUID(),format:"bo3"}).returning();
  await f.db.insert(schema.matchVetoSessions).values({matchId:match!.id,mapPoolSnapshot:pool});
  await reconcile(f);
  const market=(await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,match!.id))).find(m=>m.type==="veto_present")!;
  expect(market).toBeDefined();
  const options=await f.db.select().from(schema.betOptions).where(eq(schema.betOptions.marketId,market.id)).orderBy(schema.betOptions.position);
  return {match:match!,market,options};
}
async function complete(f:Fixture,matchId:string) {
  await f.db.insert(schema.matchVetoSessions).values({matchId,startedAt:new Date(),completedAt:new Date(),mapPoolSnapshot:pool}).onConflictDoUpdate({target:schema.matchVetoSessions.matchId,set:{startedAt:new Date(),completedAt:new Date(),mapPoolSnapshot:pool}});
  return f.db.insert(schema.matchMaps).values(pool.slice(0,3).map((mapName,i)=>({matchId,mapOrder:i+1,mapName}))).returning();
}
async function ledger(f:Fixture) {
  return (await f.db.execute(sql`select sum(amount)::text as amount, sum(profit)::text as profit, count(*)::int as count from bet_ledger where season_id=${f.seasonId}`)).rows[0]!;
}

// The PG layer protects frozen financial facts, correction reversals and admission
// serialization, which pure multiwinner arithmetic cannot prove.
describe("BO3 presence production publisher",()=>{
  it("publishes one seven-choice pool only for new unopened BO3 matches",async()=>fixture(async f=>{
    const before=await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,f.matchId));
    expect(before.filter(m=>m.type.startsWith("veto_")).map(m=>m.type)).toEqual(["veto_present"]);
    const {match,market,options}=await seed(f);
    await Promise.all([reconcile(f),reconcile(f)]);
    expect((await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,match.id))).filter(m=>m.type.startsWith("veto_"))).toEqual([market]);
    expect(options.map(o=>o.key)).toEqual(pool);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({title:"BP · 本场三图",state:"open",pool:"0",participants:0});
    expect(await f.db.query.betPrograms.findFirst({where:eq(schema.betPrograms.seasonId,f.seasonId)})).toMatchObject({catalogVersion:4});
  }));
  // Any prior BP contract blocks a new presence pool, including zero-stake terminal
  // history and changed identities. Rows are seeded as historical v2 financial facts.
  for(const terminal of [false,true]) it(`preserves ${terminal?"terminal empty":"open invested"} legacy BP terms`,async()=>fixture(async f=>{
    const original=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
    const [match]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:original!.majorStageRunId,ownership:"major_stage",managedKey:randomUUID(),format:"bo3"}).returning();
    const legacy=[];
    for(const type of ["veto_first","veto_decider"] as const) {
      const [market]=await f.db.insert(schema.betMarkets).values({seasonId:f.seasonId,matchId:match!.id,type,marketKey:`legacy/${randomUUID()}`,subject:{kind:"match",entryIds:[f.entryIds[0]!,f.entryIds[1]!],runId:original!.majorStageRunId!,format:"bo3",mapPool:pool},lockedAt:terminal?new Date():null}).returning();
      const options=await f.db.insert(schema.betOptions).values(pool.map((key,position)=>({marketId:market!.id,key,label:key,position}))).returning();
      legacy.push(market!);
      if(!terminal) await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market!.id,optionId:options[0]!.id,amount:"100",requestId:randomUUID()}));
    }
    await reconcile(f);await reconcile(f);
    expect((await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,match!.id))).filter(m=>m.type.startsWith("veto_"))).toEqual(legacy);
    await complete(f,match!.id);await reconcile(f);await reconcile(f);
    const bp=(await read(f.db,f.seasonId,f.userId)).markets.filter(m=>m.matchId===match!.id && m.group==="BP");
    expect(bp.map(m=>m.type).sort()).toEqual(["veto_decider","veto_first"]);
    if(!terminal) expect(bp.map(m=>m.mine?.payout)).toEqual(["100","100"]);
    // Official correction voids original terms; it never authorizes a replacement.
    await f.db.update(schema.matches).set({entryAId:f.entryIds[1]!,entryBId:f.entryIds[0]!}).where(eq(schema.matches.id,match!.id));
    await f.db.update(schema.matchVetoSessions).set({startedAt:null,completedAt:null}).where(eq(schema.matchVetoSessions.matchId,match!.id));
    await reconcile(f);
    expect((await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,match!.id))).filter(m=>m.type.startsWith("veto_"))).toHaveLength(2);
  }));
  it("recovers generation 3 after an older worker consumed dirty",async()=>fixture(async f=>{
    const original=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
    const [match]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:original!.majorStageRunId,ownership:"major_stage",managedKey:randomUUID(),format:"bo3"}).returning();
    await f.db.update(schema.betPrograms).set({dirty:false,catalogVersion:2}).where(eq(schema.betPrograms.seasonId,f.seasonId));
    expect((await f.db.execute(sql`select public.scheduler_job_is_due('reconcile-predictions') as due`)).rows[0]!.due).toBe(true);
    expect(await runBetReconciliationJob(f.db)).toBe(1);
    expect((await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,match!.id))).filter(m=>m.type.startsWith("veto_")).map(m=>m.type)).toEqual(["veto_present"]);
    expect(await runBetReconciliationJob(f.db)).toBe(0);
    expect((await f.db.execute(sql`select public.scheduler_job_is_due('reconcile-predictions') as due`)).rows[0]!.due).toBe(false);
  }));
  for(const kind of ["started","six","duplicate"] as const) it(`does not open a BO3 pool for ${kind} BP facts`,async()=>fixture(async f=>{
    const original=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
    const [match]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:original!.majorStageRunId,ownership:"major_stage",managedKey:randomUUID(),format:"bo3"}).returning();
    await f.db.insert(schema.matchVetoSessions).values({matchId:match!.id,startedAt:kind==="started"?new Date():null,mapPoolSnapshot:kind==="six"?pool.slice(0,6):kind==="duplicate"?[...pool.slice(0,6),pool[0]!]:pool});
    await reconcile(f);await reconcile(f);
    expect((await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,match!.id))).filter(m=>m.type.startsWith("veto_"))).toEqual([]);
  }));
  it("conserves a shared pool across three winners, correction, pending rollback and cancellation",async()=>fixture(async f=>{
    const {match,market,options}=await seed(f);
    const viewers=[f.userId,f.otherId,randomUUID(),randomUUID()];
    for(const id of viewers.slice(2)) {
      await f.db.insert(schema.users).values({id,email:`${id}@example.test`,emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration"});
      await f.db.transaction(tx=>joinBetInTx(tx,f.seasonId,id));
    }
    for(const [i,userId] of viewers.entries()) {
      const args={seasonId:f.seasonId,userId,marketId:market.id,optionId:options[i]!.id,amount:String(i+1),requestId:randomUUID()};
      await f.db.transaction(tx=>stakeBetInTx(tx,args));await f.db.transaction(tx=>stakeBetInTx(tx,args));
    }
    const open=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)!;
    expect(open).toMatchObject({pool:"10",participants:4});
    expect(open.options.map(o=>o.percent)).toEqual([10,20,30,40,0,0,0]);
    const maps=await complete(f,match.id);
    await Promise.all([reconcile(f),reconcile(f)]);
    const settled=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)!;
    expect(settled.options.filter(o=>o.winner).map(o=>o.id)).toEqual(options.slice(0,3).map(o=>o.id));
    expect(settled.mine).toMatchObject({payout:"2",profit:"1"});
    expect(await ledger(f)).toMatchObject({amount:"4000",profit:"0"});
    const checkpoint=await ledger(f);await reconcile(f);expect(await ledger(f)).toEqual(checkpoint);
    const locked=(await f.db.query.betMarkets.findFirst({where:eq(schema.betMarkets.id,market.id)}))!.lockedAt;
    await f.db.update(schema.matchMaps).set({mapName:pool[3]}).where(eq(schema.matchMaps.id,maps[2]!.id));
    await reconcile(f);expect(await ledger(f)).toMatchObject({amount:"4000",profit:"0"});
    expect((await read(f.db,f.seasonId,viewers[3]!)).markets.find(m=>m.id===market.id)?.mine).toMatchObject({payout:"6",profit:"2"});
    // Actual persisted appeal facts must reverse credits while retaining admission lock.
    const [incident]=await f.db.insert(schema.matchVetoTimeoutIncidents).values({matchId:match.id,turnKey:"ban-veto-a-opening",entryId:f.entryIds[0]!,representativeUserId:f.userId,deadlineAt:new Date(),resolvedAt:new Date(),eligibleOptions:pool,selectedOptions:[pool[6]!] }).returning();
    const [appeal]=await f.db.insert(schema.matchVetoAppeals).values({timeoutIncidentId:incident!.id,submittedBy:f.userId,reason:"核对超时证据"}).returning();
    await reconcile(f);await reconcile(f);
    expect(await ledger(f)).toMatchObject({amount:"3990",profit:"0"});
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({state:"locked",canStake:false,mine:{payout:null}});
    await f.db.update(schema.matchVetoAppeals).set({status:"rejected",resolutionScope:"participant_or_unverified",resolvedBy:f.userId,resolutionNote:"保留地图结果",resolvedAt:new Date()}).where(eq(schema.matchVetoAppeals.id,appeal!.id));
    await reconcile(f);expect(await ledger(f)).toMatchObject({amount:"4000",profit:"0"});
    await f.db.update(schema.matchVetoSessions).set({completedAt:null}).where(eq(schema.matchVetoSessions.matchId,match.id));
    await reconcile(f);expect(await ledger(f)).toMatchObject({amount:"3990",profit:"0"});
    await expect(f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:options[0]!.id,amount:"1",requestId:randomUUID()}))).rejects.toThrow(/锁定/);
    await f.db.update(schema.matchVetoSessions).set({completedAt:new Date()}).where(eq(schema.matchVetoSessions.matchId,match.id));
    await reconcile(f);expect(await ledger(f)).toMatchObject({amount:"4000",profit:"0"});
    await f.db.update(schema.matches).set({status:"cancelled"}).where(eq(schema.matches.id,match.id));
    await reconcile(f);await reconcile(f);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({state:"refunded",mine:{payout:"1",profit:"0"}});
    expect(await ledger(f)).toMatchObject({amount:"4000",profit:"0"});
    expect((await f.db.query.betMarkets.findFirst({where:eq(schema.betMarkets.id,market.id)}))!.lockedAt).toEqual(locked);
    await expect(f.db.update(schema.betLedger).set({amount:BigInt(99)})).rejects.toThrow();
  }));
  it("keeps BO5 ordered publication and refunds an empty published pool without ledger writes",async()=>fixture(async f=>{
    const {match,market}=await seed(f);
    const [bo5]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:match.majorStageRunId,ownership:"major_stage",managedKey:randomUUID(),format:"bo5"}).returning();
    const before=await ledger(f);await complete(f,match.id);await reconcile(f);await reconcile(f);
    expect(await ledger(f)).toEqual(before);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({state:"refunded",pool:"0",participants:0});
    const bp=(await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,bo5!.id))).filter(m=>m.type.startsWith("veto_"));
    expect(bp.map(m=>m.type).sort()).toEqual(["veto_decider","veto_first"]);
  }));
  for(const optionIndex of [0,6]) it(`refunds ${optionIndex===0?"all winners":"no winners"} without creating points`,async()=>fixture(async f=>{
    const {match,market,options}=await seed(f);
    for(const userId of [f.userId,f.otherId]) await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId,marketId:market.id,optionId:options[optionIndex]!.id,amount:"100",requestId:randomUUID()}));
    await complete(f,match.id);await reconcile(f);await reconcile(f);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({state:"refunded",mine:{payout:"100",profit:"0"}});
    expect(await ledger(f)).toMatchObject({amount:"2000",profit:"0"});
  }));
  it("serializes stake behind official BP start and retains the trigger lock",async()=>fixture(async f=>{
    const {match,market,options}=await seed(f);
    let admission:Promise<unknown>|undefined;
    await f.db.transaction(async writer=>{
      await writer.update(schema.matchVetoSessions).set({startedAt:new Date()}).where(eq(schema.matchVetoSessions.matchId,match.id));
      let report!:(pid:number)=>void;const ready=new Promise<number>(resolve=>{report=resolve;});
      admission=f.db.transaction(async tx=>{
        report(Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]!.pid));
        return stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:options[0]!.id,amount:"10",requestId:randomUUID()});
      }).then(()=>null,error=>error);
      const pid=await ready;
      await expect.poll(async()=>Boolean((await f.db.execute(sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`)).rows[0]!.blocked)).toBe(true);
    });
    expect(await admission).toMatchObject({message:expect.stringMatching(/锁定/)});
    expect((await f.db.query.betMarkets.findFirst({where:eq(schema.betMarkets.id,market.id)}))!.lockedAt).not.toBeNull();
    expect(await f.db.select().from(schema.betStakes).where(and(eq(schema.betStakes.marketId,market.id)))).toHaveLength(0);
  }));
});
