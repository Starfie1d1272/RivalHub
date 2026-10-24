import { randomUUID } from "node:crypto";
import { describe,it,expect } from "vitest";
import { desc, eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { fixture } from "./harness/free-prediction-fixture";
import { submitFreePredictionInTx } from "@/lib/free-predictions/service";
import { readFreePredictionBoard } from "@/lib/free-predictions/data";
import { readFreePredictionRanking, readFreePredictionRankings } from "@/lib/free-predictions/ranking";
import { operateBetInTx, joinBetInTx, stakeBetInTx, lockBetProgram, reconcileBetInTx } from "@/lib/bet/service";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
// Protect real row-lock serialization, persistent rollback fences, private DTOs and corrected scores.
describe("free predictions real PostgreSQL",()=>{
  // Execute the real read owner: the existing one-match correction case cannot
  // detect hits inheriting a P75 floor above one, or losing eligibility on voiding.
  it("a cancelled match refund keeps BET qualification independent and counts no free result",async()=>fixture(async f=>{
    await f.db.transaction(tx=>operateBetInTx(tx,{seasonId:f.seasonId,actorId:f.userId,operation:"enable"}));
    await f.db.transaction(tx=>joinBetInTx(tx,f.seasonId,f.otherId));
    const market=(await f.db.query.betMarkets.findMany({where:eq(schema.betMarkets.matchId,f.matchId)})).find(m=>m.type==="match_winner")!;
    const option=(await f.db.query.betOptions.findFirst({where:eq(schema.betOptions.marketId,market.id)}))!;
    await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.otherId,marketId:market.id,optionId:option.id,amount:"100",requestId:randomUUID()}));
    await f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:f.otherId,kind:"result",selection:[f.entryIds[0]!],requestId:randomUUID()}));
    await f.db.update(schema.matches).set({status:"cancelled"}).where(eq(schema.matches.id,f.matchId));
    await f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    expect(await f.db.query.betSettlements.findFirst({where:eq(schema.betSettlements.marketId,market.id),orderBy:desc(schema.betSettlements.revision)})).toMatchObject({state:"refunded"});
    for(const sort of ["hits","accuracy"] as const) expect(await f.db.transaction(tx=>readFreePredictionRanking(tx,f.seasonId,sort))).toMatchObject({dynamicFloor:null,rows:[expect.objectContaining({userId:f.otherId,profit:"0",hits:null,judged:null,accuracy:null,rank:null,group:"limited"})]});
    expect((await f.db.transaction(tx=>readFreePredictionRanking(tx,f.seasonId,"profit"))).rows[0]).toMatchObject({userId:f.otherId,profit:"0",rank:1,group:"ranked",hits:null,judged:null});
    const rankings = await f.db.transaction(tx=>readFreePredictionRankings(tx,f.seasonId));
    expect(rankings.profit.rows[0]).toMatchObject({userId:f.otherId,rank:1,group:"ranked"});
    for (const sort of ["hits", "accuracy"] as const) {
      expect(rankings[sort]).toMatchObject({dynamicFloor:null,rows:[expect.objectContaining({userId:f.otherId,rank:null,group:"limited"})]});
    }
  }));
  it("works without BET/join for own teams; replaces choices, retries without restoring, and hides others",async()=>fixture(async f=>{
    const input={seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"result" as const,selection:[f.entryIds[0]!],requestId:randomUUID()};
    await Promise.all([f.db.transaction(tx=>submitFreePredictionInTx(tx,input)),f.db.transaction(tx=>submitFreePredictionInTx(tx,input))]);
    await f.db.transaction(tx=>submitFreePredictionInTx(tx,{...input,requestId:randomUUID(),selection:[f.entryIds[1]!]}));
    await f.db.transaction(tx=>submitFreePredictionInTx(tx,input));
    await f.db.transaction(tx=>submitFreePredictionInTx(tx,{...input,userId:f.otherId,requestId:randomUUID()}));
    const board=await f.db.transaction(tx=>readFreePredictionBoard(tx,f.seasonId,f.userId));
    expect(board.matches[0]!.result.mine).toBe(f.entryIds[1]); expect(board.matches[0]!.result.support.counts).toEqual([1,1]);
    expect((await f.db.transaction(tx=>readFreePredictionBoard(tx,f.seasonId,null))).matches[0]!.result.mine).toBeNull();
    expect(JSON.stringify(board)).not.toContain(f.otherId);
    expect(await f.db.select().from(schema.freePredictionChoices)).toHaveLength(2);
    await f.db.update(schema.users).set({emailVerifiedAt:null,emailVerificationSource:null}).where(eq(schema.users.id,f.userId));
    await expect(f.db.transaction(tx=>submitFreePredictionInTx(tx,{...input,requestId:randomUUID()}))).rejects.toThrow("验证");
  }));
  it("serializes start ahead of a waiting submission and keeps gameplay locked after rollback",async()=>fixture(async f=>{
    let release!:()=>void, entered!:()=>void;
    const gate=new Promise<void>(r=>{release=r;});const ready=new Promise<void>(r=>{entered=r;});
    const start=f.db.transaction(async tx=>{await tx.select().from(schema.matches).where(eq(schema.matches.id,f.matchId)).for("update");entered();await gate;await tx.update(schema.matches).set({gameplayStartedAt:new Date()}).where(eq(schema.matches.id,f.matchId));});
    await ready;
    const submit=f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"result",selection:[f.entryIds[0]!],requestId:randomUUID()}));
    const rejected=expect(submit).rejects.toThrow("锁定");release();await start;await rejected;
    await expect(f.db.update(schema.matches).set({gameplayStartedAt:null}).where(eq(schema.matches.id,f.matchId))).rejects.toThrow();
    await expect(f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"result",selection:[f.entryIds[0]!],requestId:randomUUID()}))).rejects.toThrow("锁定");
  }));
  it("BP uses the complete unordered three-map set, excludes partial hits from ranking, never reopens",async()=>fixture(async f=>{
    const season=await f.db.query.seasons.findFirst({where:eq(schema.seasons.id,f.seasonId)});const pool=normalizeRegistrationConfig(season!.registrationConfig).mapPool;
    const selected=pool.slice(0,3);
    await f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"bp",selection:[...selected].reverse(),requestId:randomUUID()}));
    await f.db.insert(schema.matchVetoSessions).values({matchId:f.matchId,mapPoolSnapshot:pool,startedAt:new Date(),completedAt:new Date()});
    await f.db.insert(schema.matchMaps).values(selected.map((mapName,i)=>({matchId:f.matchId,mapName,mapOrder:i+1})));
    const read=()=>f.db.transaction(tx=>readFreePredictionBoard(tx,f.seasonId,f.userId));
    expect((await read()).matches[0]!.bp.grade?.state).toBe("correct");
    expect((await f.db.transaction(tx=>readFreePredictionRanking(tx,f.seasonId,"accuracy"))).rows[0]!.judged).toBeNull();
    await f.db.update(schema.matchMaps).set({mapName:pool[3]!}).where(eq(schema.matchMaps.mapOrder,3));
    expect((await read()).matches[0]!.bp.grade).toMatchObject({state:"incorrect",hits:2,total:3});
    await f.db.update(schema.matchVetoSessions).set({startedAt:null,completedAt:null}).where(eq(schema.matchVetoSessions.matchId,f.matchId));
    expect((await read()).matches[0]!.bp.locked).toBe(true);
    await expect(f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"bp",selection:selected,requestId:randomUUID()}))).rejects.toThrow("锁定");
  }));
  it("BP start races with submission and survives a cleared session",async()=>fixture(async f=>{
    const season=await f.db.query.seasons.findFirst({where:eq(schema.seasons.id,f.seasonId)});const pool=normalizeRegistrationConfig(season!.registrationConfig).mapPool;
    let release!:()=>void,entered!:()=>void;
    const gate=new Promise<void>(r=>{release=r;});const ready=new Promise<void>(r=>{entered=r;});
    const start=f.db.transaction(async tx=>{await tx.select().from(schema.matches).where(eq(schema.matches.id,f.matchId)).for("update");entered();await gate;await tx.insert(schema.matchVetoSessions).values({matchId:f.matchId,startedAt:new Date(),mapPoolSnapshot:pool});});
    await ready;const submit=f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"bp",selection:pool.slice(0,3),requestId:randomUUID()}));
    const rejected=expect(submit).rejects.toThrow("锁定");release();await start;await rejected;
    await f.db.delete(schema.matchVetoSessions).where(eq(schema.matchVetoSessions.matchId,f.matchId));
    expect((await f.db.transaction(tx=>readFreePredictionBoard(tx,f.seasonId,f.userId))).matches[0]!.bp.locked).toBe(true);
  }));

  it("paused BET and an exhausted joined wallet do not affect free choices; Data API remains denied",async()=>fixture(async f=>{
    await f.db.transaction(tx=>operateBetInTx(tx,{seasonId:f.seasonId,actorId:f.userId,operation:"enable"}));
    await f.db.transaction(tx=>joinBetInTx(tx,f.seasonId,f.userId));
    const account=await f.db.query.betAccounts.findFirst({where:eq(schema.betAccounts.userId,f.userId)});
    // Synthetic isolated fixture depletion, never a production participation record.
    await f.db.insert(schema.betLedger).values({seasonId:f.seasonId,accountId:account!.id,kind:"stake",source:"fixture/depleted",amount:BigInt(-1000),profit:BigInt(0)});
    await f.db.transaction(tx=>operateBetInTx(tx,{seasonId:f.seasonId,actorId:f.userId,operation:"pause"}));
    await f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"result",selection:[f.entryIds[0]!],requestId:randomUUID()}));
    const ranking=await f.db.transaction(tx=>readFreePredictionRanking(tx,f.seasonId,"profit"));
    expect(ranking.rows.find(r=>r.userId===f.userId)).toMatchObject({profit:"0",rank:null,group:"limited",accuracy:null});
    for(const role of ["anon","authenticated"]) await expect(f.db.transaction(async tx=>{
      await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));await tx.select().from(schema.freePredictionChoices);
    })).rejects.toThrow();
  }));

  it("canonical aliases retain private audit while projecting one vote and the selected account choice",async()=>fixture(async f=>{
    for(const [userId,entryId] of [[f.userId,f.entryIds[0]!],[f.otherId,f.entryIds[1]!]]) await f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:userId!,kind:"result",selection:[entryId!],requestId:randomUUID()}));
    await f.db.update(schema.users).set({status:"merged",mergedIntoUserId:f.otherId,mergedAt:new Date()}).where(eq(schema.users.id,f.userId));
    const board=await f.db.transaction(tx=>readFreePredictionBoard(tx,f.seasonId,f.otherId));
    expect(board.matches[0]!.result).toMatchObject({mine:f.entryIds[1],support:{total:1,counts:[0,1]}});
    expect(await f.db.select().from(schema.freePredictionChoices)).toHaveLength(2);
    expect(JSON.stringify(board)).not.toContain(f.userId);
  }));

});
