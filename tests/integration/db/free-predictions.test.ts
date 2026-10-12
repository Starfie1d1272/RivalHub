import { randomUUID } from "node:crypto";
import { describe,it,expect } from "vitest";
import { desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { fixture } from "./harness/free-prediction-fixture";
import { submitFreePredictionInTx } from "@/lib/free-predictions/service";
import { readFreePredictionBoard } from "@/lib/free-predictions/data";
import { readFreePredictionRanking } from "@/lib/free-predictions/ranking";
import { operateBetInTx, joinBetInTx, stakeBetInTx, lockBetProgram, reconcileBetInTx } from "@/lib/bet/service";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
// Protect real row-lock serialization, persistent rollback fences, private DTOs and corrected scores.
describe("free predictions real PostgreSQL",()=>{
  // Execute the real read owner: the existing one-match correction case cannot
  // detect hits inheriting a P75 floor above one, or losing eligibility on voiding.
  it("ranks one judged result for hits while accuracy retains the full-event P75 floor",async()=>fixture(async f=>{
    const highId=randomUUID(),missId=randomUUID(),pendingId=randomUUID();
    await f.db.insert(schema.users).values([highId,missId,pendingId].map(id=>({id,email:`${id}@example.test`,displayName:"排行观众",emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration" as const})));
    const base=(await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)}))!;
    const extraIds=Array.from({length:15},()=>randomUUID());
    await f.db.insert(schema.matches).values(extraIds.map((id,i)=>({...base,id,managedKey:`ranking:${i}`})));
    const decidedIds=[f.matchId,...extraIds.slice(0,11)];
    const [cancelledId,forfeitId,replacedId,pendingMatchId]=extraIds.slice(11) as [string,string,string,string];
    const submit=(userId:string,matchId:string,selection=[f.entryIds[0]!])=>f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId,userId,kind:"result",selection,requestId:randomUUID()}));
    for(const matchId of decidedIds) for(const userId of [f.otherId,highId]) await submit(userId,matchId);
    await submit(f.userId,f.matchId);
    await submit(missId,f.matchId,[f.entryIds[1]!]);
    for(const matchId of [cancelledId,forfeitId,replacedId]) await submit(f.userId,matchId);
    await submit(pendingId,pendingMatchId);
    const season=(await f.db.query.seasons.findFirst({where:eq(schema.seasons.id,f.seasonId)}))!;
    await f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:pendingId,kind:"bp",selection:normalizeRegistrationConfig(season.registrationConfig).mapPool.slice(0,3),requestId:randomUUID()}));
    const read=(sort:"hits"|"accuracy"|"profit",ids?:string[])=>f.db.transaction(tx=>readFreePredictionRanking(tx,f.seasonId,sort,ids));
    expect(await read("hits")).toMatchObject({dynamicFloor:null,rows:expect.arrayContaining([expect.objectContaining({userId:f.userId,hits:null,judged:null,accuracy:null,rank:null,group:"limited"})])});
    await f.db.update(schema.matches).set({status:"finished",scoreA:2,scoreB:0,completedAt:new Date()}).where(inArray(schema.matches.id,[...decidedIds,forfeitId,replacedId]));
    await f.db.update(schema.matches).set({status:"cancelled"}).where(eq(schema.matches.id,cancelledId));
    await f.db.update(schema.matches).set({isForfeit:true}).where(eq(schema.matches.id,forfeitId));
    await f.db.update(schema.matches).set({format:"bo1",scoreA:1}).where(eq(schema.matches.id,replacedId));
    const hits=await read("hits"),accuracy=await read("accuracy");
    expect(hits.dynamicFloor?.floor).toBe(1);
    expect(accuracy.dynamicFloor).toMatchObject({floor:3,reference:12,quantile:0.75,share:0.25});
    expect(hits.rows).toHaveLength(5);
    for(const userId of [f.otherId,highId]) {
      expect(hits.rows.find(r=>r.userId===userId)).toMatchObject({hits:12,judged:12,accuracy:1,rank:1,group:"ranked"});
      expect(accuracy.rows.find(r=>r.userId===userId)).toMatchObject({rank:1,group:"ranked"});
    }
    expect(hits.rows.find(r=>r.userId===f.userId)).toMatchObject({hits:1,judged:1,accuracy:1,rank:3,group:"ranked"});
    expect(hits.rows.find(r=>r.userId===missId)).toMatchObject({hits:0,judged:1,accuracy:0,rank:4,group:"ranked"});
    for(const userId of [f.userId,missId]) expect(accuracy.rows.find(r=>r.userId===userId)).toMatchObject({judged:1,rank:null,group:"limited"});
    expect(hits.rows.find(r=>r.userId===pendingId)).toMatchObject({hits:null,judged:null,accuracy:null,rank:null,group:"limited"});
    for(const sort of ["hits","accuracy"] as const) {
      const filtered=await read(sort,[f.userId]);
      expect(filtered.dynamicFloor).toEqual((sort==="hits"?hits:accuracy).dynamicFloor);
      expect(filtered.rows).toEqual((sort==="hits"?hits:accuracy).rows.filter(r=>r.userId===f.userId));
    }
    expect((await read("profit")).rows.every(r=>r.profit===null && r.rank===null && r.group==="limited")).toBe(true);
    await f.db.update(schema.matches).set({isForfeit:true}).where(eq(schema.matches.id,f.matchId));
    for(const sort of ["hits","accuracy"] as const) expect((await read(sort)).rows.find(r=>r.userId===f.userId)).toMatchObject({hits:null,judged:null,accuracy:null,rank:null,group:"limited"});
  }));
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
  it("canonical score corrections and forfeits reproject accuracy; filter preserves event floor",async()=>fixture(async f=>{
    for(const userId of [f.userId,f.otherId]) await f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId,kind:"result",selection:[f.entryIds[0]!],requestId:randomUUID()}));
    await f.db.update(schema.matches).set({status:"finished",scoreA:2,scoreB:0,completedAt:new Date()}).where(eq(schema.matches.id,f.matchId));
    const read=()=>f.db.transaction(tx=>readFreePredictionRanking(tx,f.seasonId,"accuracy"));
    expect((await read()).rows[0]).toMatchObject({hits:1,judged:1,accuracy:1,rank:1});
    const filtered=await f.db.transaction(tx=>readFreePredictionRanking(tx,f.seasonId,"accuracy",[f.otherId]));expect(filtered.dynamicFloor).toEqual((await read()).dynamicFloor);
    await f.db.update(schema.matches).set({scoreA:0,scoreB:2}).where(eq(schema.matches.id,f.matchId));expect((await read()).rows[0]!.accuracy).toBe(0);
    await f.db.update(schema.matches).set({isForfeit:true}).where(eq(schema.matches.id,f.matchId));expect((await read()).rows[0]!.accuracy).toBeNull();
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
  for(const format of ["bo1","bo5"] as const) it(`${format} validates and grades unordered full BP`,async()=>fixture(async f=>{
    await f.db.update(schema.matches).set({format}).where(eq(schema.matches.id,f.matchId));
    const season=await f.db.query.seasons.findFirst({where:eq(schema.seasons.id,f.seasonId)});const pool=normalizeRegistrationConfig(season!.registrationConfig).mapPool;
    const selection=pool.slice(0,Number(format.slice(2)));
    const input={seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"bp" as const,selection,requestId:randomUUID()};
    await expect(f.db.transaction(tx=>submitFreePredictionInTx(tx,{...input,selection:[...selection,selection[0]!]}))).rejects.toThrow("检查");
    await f.db.transaction(tx=>submitFreePredictionInTx(tx,input));
    await f.db.insert(schema.matchVetoSessions).values({matchId:f.matchId,startedAt:new Date(),completedAt:new Date(),mapPoolSnapshot:pool});
    await f.db.insert(schema.matchMaps).values([...selection].reverse().map((mapName,i)=>({matchId:f.matchId,mapName,mapOrder:i+1})));
    expect((await f.db.transaction(tx=>readFreePredictionBoard(tx,f.seasonId,f.userId))).matches[0]!.bp.grade?.state).toBe("correct");
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
