import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { claimBetReliefInTx, stakeBetInTx, lockBetProgram, reconcileBetInTx, operateBetInTx, joinBetInTx } from "@/lib/bet/service";
import { readBetRelief, betReliefDay } from "@/lib/bet/relief-data";
import { fixture, read } from "./harness/bet-fixture";
// Exercise the actual second-release publisher1 contract against real PG.
// No capability, financial owner or immutable guard is mocked.

type F = Parameters<Parameters<typeof fixture>[0]>[0];
const eligibility = (f:F, userId=f.userId) => f.db.transaction(tx=>readBetRelief(tx,f.seasonId,userId),{accessMode:"read only",isolationLevel:"repeatable read"});
const claim = async (f:F, day?:string) => f.db.transaction(tx=>claimBetReliefInTx(tx,{seasonId:f.seasonId,userId:f.userId,day:day!}));
const reconcile = (f:F) => f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
async function drain(f:F, balance=0) {
  const board=await read(f.db,f.seasonId,f.userId);
  const market=board.markets.find(m=>m.type==="match_winner")!;
  await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:market.options[0]!.id,amount:(BigInt(board.balance)-BigInt(balance)).toString(),requestId:randomUUID()}));
  return market;
}
// Only this disposable DB defines a controllable SQL clock. No product test hook or browser clock.
async function installClock(f:F, timestamp:string) {
  await f.db.execute(sql`create table relief_test_clock (instant timestamptz not null)`);
  await f.db.execute(sql`insert into relief_test_clock values (${timestamp}::timestamptz)`);
  await f.db.execute(sql`create function public.clock_timestamp() returns timestamptz language sql volatile as 'select instant from public.relief_test_clock'`);
}
async function clockClaim(f:F, day:string) {
  return f.db.transaction(async tx=>{await tx.execute(sql`set local search_path = public, pg_catalog`);return claimBetReliefInTx(tx,{seasonId:f.seasonId,userId:f.userId,day});});
}
describe("BET relief real ledger and serialization",()=>{
  // Real ledger sums, unique keys and existing program locks protect issuance.
  it.each([[0,"10"],[9,"1"],[10,null]] as const)("tops up balance %s once, preserving profit",async(balance,amount)=>fixture(async f=>{
    await drain(f,balance);
    const before=await f.db.select().from(schema.betLedger);
    const dto=await eligibility(f);
    expect(dto.amount).toBe(amount??"0");
    expect(await f.db.select().from(schema.betLedger)).toEqual(before); // GET is a pure read.
    if(!amount){await expect(claim(f,dto.day)).rejects.toThrow(/余额/);return;}
    const results=await Promise.all([claim(f,dto.day),claim(f,dto.day),claim(f,dto.day)]);
    expect(results.filter(r=>!r.replayed)).toHaveLength(1);
    expect(results.every(r=>r.amount===amount)).toBe(true);
    const board=await read(f.db,f.seasonId,f.userId);
    expect(board).toMatchObject({balance:"10",profit:"0",rank:null});
    expect(board.records.filter(r=>r.label==="低保补给")).toHaveLength(1);
    const account=await f.db.query.betAccounts.findFirst({where:and(eq(schema.betAccounts.userId,f.userId),eq(schema.betAccounts.seasonId,f.seasonId))});
    const grants=await f.db.select().from(schema.betLedger).where(and(eq(schema.betLedger.accountId,account!.id),eq(schema.betLedger.kind,"relief")));
    expect(grants).toHaveLength(1);expect(grants[0]).toMatchObject({amount:BigInt(amount),profit:BigInt(0),source:`relief/${dto.day}`});
    await drain(f);
    expect(await eligibility(f)).toMatchObject({reason:"claimed_today",amount:"0",granted:amount});
    expect((await claim(f,dto.day)).replayed).toBe(true);
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe("0");
  }));
  it("uses the post-lock database Beijing day, rejects midnight replays and limits only relief",async()=>fixture(async f=>{
    await drain(f);
    const account=await f.db.query.betAccounts.findFirst({where:and(eq(schema.betAccounts.userId,f.userId),eq(schema.betAccounts.seasonId,f.seasonId))});
    await f.db.transaction(async tx=>{
      await lockBetProgram(tx,f.seasonId);
      await tx.insert(schema.betLedger).values(Array.from({length:10},(_,i)=>({seasonId:f.seasonId,accountId:account!.id,kind:"relief" as const,source:`relief/2000-01-${String(i+1).padStart(2,"0")}`,amount:i===9?BigInt(9):BigInt(10),profit:BigInt(0)})));
    });
    // Prior fixture grants are consumed through the real stake owner.
    await drain(f);
    const dto=await eligibility(f);expect(dto).toMatchObject({amount:"1",granted:"99",remaining:"1"});
    const dbDay=await f.db.transaction(tx=>betReliefDay(tx));expect(dto.day).toBe(dbDay);
    const clock=(await f.db.execute(sql`select to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD') as day,
      to_char('2026-10-11 15:59:59+00'::timestamptz at time zone 'Asia/Shanghai','YYYY-MM-DD') as before,
      to_char('2026-10-11 16:00:00+00'::timestamptz at time zone 'Asia/Shanghai','YYYY-MM-DD') as after`)).rows[0];
    expect(clock).toMatchObject({day:dto.day,before:"2026-10-11",after:"2026-10-12"});
    await expect(claim(f,"2000-01-11")).rejects.toThrow(/日期/);
    expect(await claim(f,dto.day)).toMatchObject({amount:"1",replayed:false});
    expect(await eligibility(f)).toMatchObject({granted:"100",remaining:"0"});
    await drain(f);
    expect((await claim(f,dto.day)).replayed).toBe(true);
    await installClock(f,"2100-01-01 00:00:00+00");
    await expect(clockClaim(f,"2100-01-01")).rejects.toThrow(/额度/);
    expect(await f.db.transaction(tx=>readBetRelief(tx,f.seasonId,f.userId,"2100-01-01"))).toMatchObject({reason:"limit_reached",amount:"0"});
    const previous=await f.db.query.seasons.findFirst({where:eq(schema.seasons.id,f.seasonId)});
    const nextId=randomUUID();await f.db.insert(schema.seasons).values({...previous!,id:nextId,slug:`relief-${nextId}`});
    expect(await f.db.transaction(tx=>readBetRelief(tx,nextId,f.userId))).toMatchObject({reason:"disabled",granted:"0",remaining:"100"});
    await expect(f.db.transaction(tx=>claimBetReliefInTx(tx,{seasonId:nextId,userId:f.userId,day:dto.day}))).rejects.toThrow(/尚未开放/);
    await f.db.transaction(tx=>operateBetInTx(tx,{seasonId:nextId,actorId:f.userId,operation:"enable"}));
    await f.db.transaction(tx=>joinBetInTx(tx,nextId,f.userId));
    expect(await f.db.transaction(tx=>readBetRelief(tx,nextId,f.userId))).toMatchObject({granted:"0",remaining:"100",reason:"balance_sufficient"});
    // Constraint also rejects accidental new producers with bad profit/amount.
    await expect(f.db.insert(schema.betLedger).values({seasonId:f.seasonId,accountId:account!.id,kind:"relief",source:"relief/2000-02-01",amount:BigInt(11)})).rejects.toThrow();
    await expect(f.db.insert(schema.betLedger).values({seasonId:f.seasonId,accountId:account!.id,kind:"relief",source:"relief/2000-02-01",amount:BigInt(1),profit:BigInt(1)})).rejects.toThrow();
  }));
  it("reads the clock after a real program-lock wait across Beijing midnight, then grants a new day",async()=>fixture(async f=>{
    await drain(f);await installClock(f,"2026-10-11 15:59:59+00");
    let waiting:Promise<unknown>|undefined;
    await f.db.transaction(async writer=>{
      await lockBetProgram(writer,f.seasonId);
      let reportPid!:(pid:number)=>void;const ready=new Promise<number>(resolve=>{reportPid=resolve;});
      waiting=f.db.transaction(async tx=>{
        await tx.execute(sql`set local search_path = public, pg_catalog`);
        reportPid(Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]!.pid));
        return claimBetReliefInTx(tx,{seasonId:f.seasonId,userId:f.userId,day:"2026-10-11"});
      }).then(()=>null,error=>error);
      const pid=await ready;
      await expect.poll(async()=>Boolean((await f.db.execute(sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`)).rows[0]!.blocked)).toBe(true);
      await f.db.execute(sql`update relief_test_clock set instant = '2026-10-11 16:00:00+00'`);
    });
    expect(await waiting).toMatchObject({message:expect.stringMatching(/日期/)});
    expect(await f.db.select().from(schema.betLedger).where(eq(schema.betLedger.kind,"relief"))).toHaveLength(0);
    expect(await clockClaim(f,"2026-10-12")).toMatchObject({amount:"10",replayed:false});await drain(f);
    expect(await clockClaim(f,"2026-10-12")).toMatchObject({replayed:true});
    await f.db.execute(sql`update relief_test_clock set instant = '2026-10-12 16:00:00+00'`);
    expect(await clockClaim(f,"2026-10-13")).toMatchObject({amount:"10",replayed:false});
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe("10");
    expect((await eligibility(f)).granted).toBe("20");
  }));
  it("refuses unjoined, invalid, paused and closed accounts without creating or changing them",async()=>fixture(async f=>{
    const id=randomUUID();await f.db.insert(schema.users).values({id,email:`${id}@example.test`,emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration"});
    const unjoined=await eligibility(f,id);expect(unjoined).toMatchObject({reason:"join_required"});
    expect(await f.db.transaction(tx=>readBetRelief(tx,f.seasonId,null))).toMatchObject({reason:"login_required"});
    await expect(f.db.transaction(tx=>claimBetReliefInTx(tx,{seasonId:f.seasonId,userId:id,day:unjoined.day}))).rejects.toThrow(/先领取/);
    expect(await f.db.query.betAccounts.findFirst({where:eq(schema.betAccounts.userId,id)})).toBeUndefined();
    await drain(f);const day=(await eligibility(f)).day;
    for(const patch of [{emailVerifiedAt:null},{status:"merged" as const,mergedIntoUserId:f.otherId,mergedAt:new Date()}]){
      await f.db.update(schema.users).set(patch).where(eq(schema.users.id,f.userId));
      expect(await eligibility(f)).toMatchObject({reason:"account_invalid"});
      await expect(claim(f,day)).rejects.toThrow(/验证/);
      await f.db.update(schema.users).set({status:"active",emailVerifiedAt:new Date(),mergedIntoUserId:null,mergedAt:null}).where(eq(schema.users.id,f.userId));
    }
    await f.db.update(schema.betPrograms).set({paused:true}).where(eq(schema.betPrograms.seasonId,f.seasonId));
    expect(await eligibility(f)).toMatchObject({reason:"paused"});await expect(claim(f,day)).rejects.toThrow(/暂停/);
    await f.db.update(schema.betPrograms).set({paused:false}).where(eq(schema.betPrograms.seasonId,f.seasonId));
    for(const status of ["finished","archived"] as const){await f.db.update(schema.seasons).set({status}).where(eq(schema.seasons.id,f.seasonId));expect(await eligibility(f)).toMatchObject({reason:"season_closed"});await expect(claim(f,day)).rejects.toThrow();}
    expect(await f.db.select().from(schema.betLedger).where(eq(schema.betLedger.kind,"relief"))).toHaveLength(0);
  }));
  it("serializes a claim against ALL IN and stage supply without double issuance",async()=>fixture(async f=>{
    const market=await drain(f);const day=(await eligibility(f)).day;
    const results=await Promise.allSettled([claim(f,day),f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:market.options[0]!.id,amount:"all",requestId:randomUUID()}))]);
    expect(results[0].status).toBe("fulfilled");
    const board=await read(f.db,f.seasonId,f.userId);expect(["0","10"]).toContain(board.balance);
    expect(await eligibility(f)).toMatchObject({reason:"claimed_today",granted:"10"});
    const run=await f.db.query.majorStageRuns.findFirst({where:eq(schema.majorStageRuns.seasonId,f.seasonId)});
    await f.db.insert(schema.majorStageRuns).values({seasonId:f.seasonId,stageKey:"stage2",startedBy:"test",ruleSnapshot:run!.ruleSnapshot});
    await Promise.all([claim(f,day),reconcile(f),reconcile(f)]);
    const account=await f.db.query.betAccounts.findFirst({where:and(eq(schema.betAccounts.userId,f.userId),eq(schema.betAccounts.seasonId,f.seasonId))});
    expect(await f.db.select().from(schema.betLedger).where(and(eq(schema.betLedger.accountId,account!.id),eq(schema.betLedger.source,"stage/stage2")))).toHaveLength(1);
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe(String(BigInt(board.balance)+BigInt(300)));
    expect(await eligibility(f)).toMatchObject({granted:"10"});
  }));
  it.each(["claim_first","stage_first"] as const)("serializes a fresh claim and stage grant: %s",async(order)=>fixture(async f=>{
    await drain(f);const day=(await eligibility(f)).day;
    const run=await f.db.query.majorStageRuns.findFirst({where:eq(schema.majorStageRuns.seasonId,f.seasonId)});
    await f.db.insert(schema.majorStageRuns).values({seasonId:f.seasonId,stageKey:"stage2",startedBy:"test",ruleSnapshot:run!.ruleSnapshot});
    let queued:Promise<unknown>|undefined;
    await f.db.transaction(async first=>{
      if(order==="claim_first") await claimBetReliefInTx(first,{seasonId:f.seasonId,userId:f.userId,day});
      else {await lockBetProgram(first,f.seasonId);await reconcileBetInTx(first,f.seasonId);}
      let reportPid!:(pid:number)=>void;const ready=new Promise<number>(resolve=>{reportPid=resolve;});
      queued=f.db.transaction(async second=>{
        reportPid(Number((await second.execute(sql`select pg_backend_pid() as pid`)).rows[0]!.pid));
        if(order==="stage_first") return claimBetReliefInTx(second,{seasonId:f.seasonId,userId:f.userId,day});
        await lockBetProgram(second,f.seasonId);return reconcileBetInTx(second,f.seasonId);
      }).then(result=>result,error=>error);
      const pid=await ready;await expect.poll(async()=>Boolean((await f.db.execute(sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`)).rows[0]!.blocked)).toBe(true);
    });
    const result=await queued;
    if(order==="stage_first") expect(result).toMatchObject({message:expect.stringMatching(/余额/)});
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe(order==="claim_first"?"310":"300");
    expect((await eligibility(f)).granted).toBe(order==="claim_first"?"10":"0");
  }));
  it("preserves correction debt and refunds it before allowing relief",async()=>fixture(async f=>{
    const market=await drain(f);
    await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.otherId,marketId:market.id,optionId:market.options[1]!.id,amount:"all",requestId:randomUUID()}));
    await f.db.update(schema.matches).set({status:"finished",scoreA:2,scoreB:0,completedAt:new Date()}).where(eq(schema.matches.id,f.matchId));await reconcile(f);
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe("2000");
    const original=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
    const [next]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,majorStageRunId:original!.majorStageRunId,stage:"stage1",ownership:"major_stage",managedKey:"relief-debt",format:"bo3"}).returning();await reconcile(f);
    const nextMarket=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.matchId===next!.id&&m.type==="match_winner")!;
    await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:nextMarket.id,optionId:nextMarket.options[0]!.id,amount:"all",requestId:randomUUID()}));
    await f.db.update(schema.matches).set({scoreA:0,scoreB:2}).where(eq(schema.matches.id,f.matchId));
    await Promise.all([reconcile(f),reconcile(f)]);
    const dto=await eligibility(f);expect(dto).toMatchObject({reason:"debt",canClaim:false,granted:"0"});
    await expect(claim(f,dto.day)).rejects.toThrow(/抵扣/);
    expect((await read(f.db,f.seasonId,f.userId)).debt).toBe("2000");
    await f.db.update(schema.matches).set({status:"cancelled"}).where(eq(schema.matches.id,next!.id));
    await Promise.all([reconcile(f),claim(f,dto.day).catch(()=>null)]);
    const after=await eligibility(f);
    if(after.canClaim) await claim(f,after.day);
    expect((await read(f.db,f.seasonId,f.userId))).toMatchObject({balance:"10",debt:"0",profit:"-1000"});
    expect(await eligibility(f)).toMatchObject({granted:"10",reason:"claimed_today"});
  }));
});
