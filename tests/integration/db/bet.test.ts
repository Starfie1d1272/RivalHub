import { readUnifiedBetBoard } from "@/lib/bet/board-read";
import { randomUUID } from "node:crypto";
import { eq,and,sql } from "drizzle-orm";
import { describe,it,expect } from "vitest";
import * as schema from "@/db/schema";
import { operateBetInTx,joinBetInTx,stakeBetInTx,betBalance,lockBetProgram,reconcileBetInTx,runBetReconciliationJob } from "@/lib/bet/service";
import { betBoard } from "@/lib/bet/data";
import { fixture,read } from "./harness/bet-fixture";
describe("BET transactional admission and settlement",()=>{
  // Real SQL protects per-team sums and lifecycle retention; component fixtures cannot.

  it("allows administrators while retaining current roster conflicts in both read and write paths", async () => fixture(async f => {
    await f.db.update(schema.users).set({role:"super_admin"}).where(eq(schema.users.id,f.userId));
    await f.db.insert(schema.seasonAdminGrants).values({seasonId:f.seasonId,userId:f.otherId});
    const market=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.type==="match_winner")!;
    for (const userId of [f.userId,f.otherId]) {
      expect((await read(f.db,f.seasonId,userId)).markets.find(m=>m.id===market.id)).toMatchObject({canStake:true,restriction:null});
      await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId,marketId:market.id,optionId:market.options[0]!.id,amount:"100",requestId:randomUUID()}));
    }
    const entry=await f.db.query.competitionEntries.findFirst({where:eq(schema.competitionEntries.id,f.entryIds[0]!)});
    const [roster]=await f.db.insert(schema.eventRosters).values({entryId:f.entryIds[0]!,sourceRosterRevisionId:entry!.approvedRosterRevisionId,status:"confirmed",confirmedAt:new Date(),confirmedBy:"test"}).returning();
    const [member]=await f.db.insert(schema.eventRosterMembers).values({eventRosterId:roster!.id,userId:f.userId}).returning();
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)).toMatchObject({canStake:false,restriction:"相关队伍名单成员不能参与此盘口"});
    expect((await f.db.transaction(tx=>readUnifiedBetBoard(tx,f.seasonId,f.userId))).bet.markets.find(m=>m.id===market.id)).toMatchObject({canStake:false,restriction:"相关队伍名单成员不能参与此盘口"});
    await expect(f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:market.options[0]!.id,amount:"10",requestId:randomUUID()}))).rejects.toThrow(/名单成员/);
    await f.db.update(schema.eventRosterMembers).set({isCurrent:false}).where(eq(schema.eventRosterMembers.id,member!.id));
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)?.canStake).toBe(true);
  }));

  it("recovers pre-enable stage milestones, grants future stages once and never joins or catches up from GET", async () => fixture(async f => {
    const {db,seasonId,userId}=f;
    const reconcile=()=>db.transaction(async tx=>{await lockBetProgram(tx,seasonId);await reconcileBetInTx(tx,seasonId);});
    const run=await db.query.majorStageRuns.findFirst({where:eq(schema.majorStageRuns.seasonId,seasonId)});
    const milestones=await db.select().from(schema.betStageMilestones).where(eq(schema.betStageMilestones.seasonId,seasonId));
    expect(milestones.map(m=>m.stageKey)).toEqual(["stage1"]); // StageRun was created before enable in fixture.
    expect((await read(db,seasonId,userId)).balance).toBe("1000");
    await db.transaction(tx=>joinBetInTx(tx,seasonId,userId));await reconcile();
    expect((await read(db,seasonId,userId)).records.map(r=>r.label)).toEqual(["初始积分"]);
    await db.insert(schema.majorStageRuns).values({seasonId,stageKey:"stage2",startedBy:"test",ruleSnapshot:run!.ruleSnapshot});
    await reconcile();await reconcile();
    expect((await read(db,seasonId,userId)).balance).toBe("1300");
    expect((await read(db,seasonId,userId)).rank).toBeNull();
    const late=randomUUID();await db.insert(schema.users).values({id:late,email:`${late}@example.test`,emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration"});
    const before=await read(db,seasonId,late);expect(before.joined).toBe(false);expect(before.records).toEqual([]);
    expect(await db.query.betAccounts.findFirst({where:eq(schema.betAccounts.userId,late)})).toBeUndefined();
    await db.transaction(tx=>joinBetInTx(tx,seasonId,late));await reconcile();
    expect((await read(db,seasonId,late)).balance).toBe("1000");
    await db.insert(schema.competitionQualificationRuns).values({seasonId,format:"short_swiss_2w2l",targetEntrantCount:1,candidateCount:2,directEntryCount:0,playInEntryCount:2,qualifierCount:1,configuredBy:"test"});
    await reconcile();expect((await read(db,seasonId,userId)).balance).toBe("1300");
    await db.insert(schema.majorStageRuns).values({seasonId,stageKey:"playoffs",startedBy:"test",ruleSnapshot:run!.ruleSnapshot});
    await reconcile();await reconcile();
    expect((await read(db,seasonId,userId)).balance).toBe("1600");
    expect((await read(db,seasonId,late)).balance).toBe("1300");
  }));

  it("ranks current settled profit with competition ties and exposes only the viewer's safe history", async () => fixture(async f => {
    const {db,seasonId,userId,otherId,matchId}=f;
    const third=randomUUID();await db.insert(schema.users).values({id:third,email:`${third}@example.test`,displayName:"第三位",emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration"});
    await db.transaction(tx=>joinBetInTx(tx,seasonId,third));
    const initial=await read(db,seasonId,userId);expect(initial.rank).toBeNull();expect(initial.leaderboard).toEqual([]);
    const m=initial.markets.find(m=>m.type==="match_winner")!;
    for (const [id,option,amount] of [[userId,0,"100"],[otherId,0,"100"],[third,1,"200"]] as const) {
      await db.transaction(tx=>stakeBetInTx(tx,{seasonId,userId:id,marketId:m.id,optionId:m.options[option]!.id,amount,requestId:randomUUID()}));
    }
    expect((await read(db,seasonId,userId)).rank).toBeNull();
    await db.update(schema.matches).set({status:"finished",scoreA:2,scoreB:0,completedAt:new Date()}).where(eq(schema.matches.id,matchId));
    const reconcile=()=>db.transaction(async tx=>{await lockBetProgram(tx,seasonId);await reconcileBetInTx(tx,seasonId);});await reconcile();
    const board=await read(db,seasonId,userId);
    expect(board.leaderboard.map(r=>[r.userId,r.profit,r.rank,r.settledCount])).toEqual([[userId,"100",1,1],[otherId,"100",1,1],[third,"-200",3,1]]);
    expect(board.leaderboard.every(row => row.playerUserId === null)).toBe(true);
    await db.update(schema.users).set({ gameplayStyle: "已填写选手打法" }).where(eq(schema.users.id, otherId));
    expect((await read(db, seasonId, userId)).leaderboard.find(row => row.userId === otherId)?.playerUserId).toBe(otherId);
    await db.update(schema.users).set({ gameplayStyle: null }).where(eq(schema.users.id, otherId));
    for(const id of [userId,otherId,third])expect((await db.transaction(tx=>readUnifiedBetBoard(tx,seasonId,id))).bet.rank).toBe(id===third?3:1);
    expect(board.rank).toBe(1);expect(board.records.map(r=>r.amount)).toEqual(["200","-100","1000"]);
    expect(board.records.every(r=>Object.keys(r).sort().join(",")==="amount,context,createdAt,label")).toBe(true);
    expect(board.leaderboard.every(r=>Object.keys(r).sort().join(",")==="name,playerUserId,profit,rank,settledCount,userId")).toBe(true);
    const anonymous=await db.transaction(tx=>betBoard(tx,seasonId,null),{accessMode:"read only"});
    expect(anonymous.records).toEqual([]);expect(anonymous.leaderboard).toEqual(board.leaderboard);
    const run=await db.query.majorStageRuns.findFirst({where:eq(schema.majorStageRuns.seasonId,seasonId)});
    await db.insert(schema.majorStageRuns).values({seasonId,stageKey:"stage2",startedBy:"test",ruleSnapshot:run!.ruleSnapshot});await reconcile();
    expect((await read(db,seasonId,userId)).leaderboard).toEqual(board.leaderboard);
    await db.update(schema.matches).set({scoreA:0,scoreB:2}).where(eq(schema.matches.id,matchId));await reconcile();
    const corrected=await read(db,seasonId,userId);
    expect(corrected.leaderboard.map(r=>[r.userId,r.profit,r.rank])).toEqual([[third,"200",1],[userId,"-100",2],[otherId,"-100",2]]);
    expect((await db.transaction(tx=>readUnifiedBetBoard(tx,seasonId,userId))).bet).toMatchObject({rank:2,balance:corrected.balance,debt:corrected.debt,profit:corrected.profit,markets:corrected.markets});
    expect(corrected.records.some(r=>r.label.includes("官方赛果更正") && r.amount==="-200")).toBe(true);
    expect(corrected.records.some(r=>r.label==="结算" && r.amount==="0")).toBe(true);
    await db.update(schema.matches).set({status:"in_progress",scoreA:null,scoreB:null,completedAt:null}).where(eq(schema.matches.id,matchId));await reconcile();
    const pending=await read(db,seasonId,userId);expect(pending.rank).toBeNull();expect(pending.leaderboard).toEqual([]);
    expect((await db.transaction(tx=>readUnifiedBetBoard(tx,seasonId,userId))).bet).toMatchObject({rank:null,balance:pending.balance,profit:pending.profit});
  }));

  it("serializes official updates with BET operations without a market/program deadlock",async()=>fixture(async f=>{
    const market=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.type==="match_winner")!;
    let official: Promise<unknown> | undefined;
    await f.db.transaction(async tx=>{
      await lockBetProgram(tx,f.seasonId);
      let reportPid!: (pid:number)=>void;
      const pidReady=new Promise<number>(resolve=>{reportPid=resolve;});
      official=f.db.transaction(async writer=>{
        const result=await writer.execute(sql`select pg_backend_pid() as pid`);
        reportPid(Number(result.rows[0]!.pid));
        await writer.update(schema.matches).set({gameplayStartedAt:new Date()}).where(eq(schema.matches.id,f.matchId));
      }).then(()=>null,error=>error);
      const pid=await pidReady;
      await expect.poll(async()=>{
        const result=await f.db.execute(sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`);
        return result.rows[0]!.blocked;
      }).toBe(true);
      await operateBetInTx(tx,{seasonId:f.seasonId,actorId:f.userId,operation:"close",marketId:market.id});
    });
    expect(await official).toBeNull();
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)?.state).toBe("locked");
  }));

  it("locks series admission from a canonical map result even without a separate start marker",async()=>fixture(async f=>{
    const market=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.type==="match_winner")!;
    await f.db.update(schema.matches).set({status:"in_progress"}).where(eq(schema.matches.id,f.matchId));
    await f.db.insert(schema.matchVetoSessions).values({matchId:f.matchId,startedAt:new Date(),completedAt:new Date(),mapPoolSnapshot:["de_inferno","de_nuke","de_mirage"]});
    await f.db.insert(schema.matchMaps).values({matchId:f.matchId,mapOrder:1,mapName:"de_inferno",completedAt:new Date(),scoreA:13,scoreB:7});
    const board=await read(f.db,f.seasonId,f.userId);
    expect(board.markets.find(m=>m.id===market.id)?.state).toBe("locked");
    await expect(f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:market.options[0]!.id,amount:"100",requestId:randomUUID()}))).rejects.toThrow(/锁定/);
    await f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    expect((await read(f.db,f.seasonId,f.userId)).markets.filter(m=>m.type==="match_winner")).toHaveLength(1);
  }));

  it("refunds an already locked market without changing the database lock precision",async()=>fixture(async f=>{
    const market=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.type==="match_winner")!;
    await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:market.options[0]!.id,amount:"200",requestId:randomUUID()}));
    await f.db.update(schema.matches).set({gameplayStartedAt:new Date()}).where(eq(schema.matches.id,f.matchId));
    const before=(await f.db.execute(sql`select locked_at::text as locked from bet_markets where id=${market.id}`)).rows[0]?.locked;
    await f.db.transaction(tx=>operateBetInTx(tx,{seasonId:f.seasonId,actorId:f.userId,operation:"void",marketId:market.id,reason:"已锁盘异常退款"}));
    const after=(await f.db.execute(sql`select locked_at::text as locked from bet_markets where id=${market.id}`)).rows[0]?.locked;
    expect(after).toBe(before);
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe("1000");
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===market.id)?.state).toBe("refunded");
  }));

  it("does not backfill pre-game markets for legacy gameplay and preserves deleted match refunds",async()=>fixture(async f=>{
    const original=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
    const oldDate=new Date(Date.now()-60000);
    const [legacy]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:original!.majorStageRunId,ownership:"major_stage",managedKey:"legacy",round:2,format:"bo3",status:"in_progress",startedAt:oldDate}).returning();
    await f.db.insert(schema.matchVetoSessions).values({matchId:legacy!.id,startedAt:oldDate,completedAt:oldDate,mapPoolSnapshot:["de_inferno","de_nuke","de_mirage"]});
    await f.db.insert(schema.matchMaps).values([{matchId:legacy!.id,mapOrder:1,mapName:"de_inferno",completedAt:oldDate,scoreA:13,scoreB:7},{matchId:legacy!.id,mapOrder:2,mapName:"de_nuke"}]);
    const reconcile=()=>f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    await reconcile();expect((await read(f.db,f.seasonId,f.userId)).markets.filter(m=>m.matchId===legacy!.id)).toHaveLength(0);
    const market=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.matchId===f.matchId && m.type==="match_winner")!;
    await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:market.id,optionId:market.options[0]!.id,amount:"200",requestId:randomUUID()}));
    await f.db.delete(schema.matches).where(eq(schema.matches.id,f.matchId));await reconcile();
    const board=await read(f.db,f.seasonId,f.userId);
    expect(board.balance).toBe("1000");expect(board.markets.find(m=>m.id===market.id)?.state).toBe("refunded");
    expect(board.matches.find(m=>m.id===f.matchId)).toMatchObject({a:"银河",b:"新星",stage:"已更正比赛"});
  }));

  it("opens BO1 Play-in without a PickEm program and offers no duplicate map winner",async()=>fixture(async f=>{
    const [run]=await f.db.insert(schema.competitionQualificationRuns).values({seasonId:f.seasonId,format:"short_swiss_2w2l",targetEntrantCount:1,candidateCount:2,directEntryCount:0,playInEntryCount:2,qualifierCount:1,configuredBy:"test"}).returning();
    const [match]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"play-in",qualificationRunId:run!.id,format:"bo1"}).returning();
    await f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    expect((await read(f.db,f.seasonId,f.userId)).markets.filter(m=>m.matchId===match!.id).map(m=>m.type).sort()).toEqual(["match_winner","total_rounds","veto_map"]);
    const prematch=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.matchId===match!.id && m.type==="total_rounds")!;
    expect(prematch).toMatchObject({context:"第1图 · 地图待定",canStake:true});
    await f.db.transaction(tx=>stakeBetInTx(tx,{seasonId:f.seasonId,userId:f.userId,marketId:prematch.id,optionId:prematch.options[1]!.id,amount:"100",requestId:randomUUID()}));
    await f.db.insert(schema.matchVetoSessions).values({matchId:match!.id,startedAt:new Date(),completedAt:new Date(),mapPoolSnapshot:["de_inferno"]});
    await f.db.insert(schema.matchMaps).values({matchId:match!.id,mapOrder:1,mapName:"de_inferno"});
    await f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    const types=(await read(f.db,f.seasonId,f.userId)).markets.filter(m=>m.matchId===match!.id).map(m=>m.type);
    expect(types).toContain("total_rounds");expect(types).not.toContain("map_winner");
    expect(types.filter(t=>t==="total_rounds")).toHaveLength(1);
    await f.db.update(schema.matches).set({status:"cancelled"}).where(eq(schema.matches.id,match!.id));
    await f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===prematch.id)).toMatchObject({state:"refunded",mine:{amount:"100",payout:"100"}});
  }));
  it("opens map winners in sequence while prematch totals lock independently and refund an unplayed decider",async()=>fixture(async f=>{
    await f.db.insert(schema.matchVetoSessions).values({matchId:f.matchId,startedAt:new Date(),completedAt:new Date(),mapPoolSnapshot:["de_inferno","de_nuke","de_mirage"]});
    const maps=await f.db.insert(schema.matchMaps).values(["de_inferno","de_nuke","de_mirage"].map((mapName,i)=>({matchId:f.matchId,mapOrder:i+1,mapName}))).returning();
    const reconcile=()=>f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});await reconcile();
    const board=await read(f.db,f.seasonId,f.userId);const rounds=board.markets.find(m=>m.type==="total_rounds" && m.context.startsWith("第1图"))!;
    expect(board.markets.filter(m=>m.type==="total_rounds")).toHaveLength(3);
    expect(board.markets.filter(m=>m.type==="map_winner")).toHaveLength(1);
    await expect(f.db.update(schema.betMarkets).set({line:45}).where(eq(schema.betMarkets.id,rounds.id))).rejects.toThrow();
    await f.db.update(schema.matchMaps).set({startedAt:new Date()}).where(eq(schema.matchMaps.id,maps[0]!.id));
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===rounds.id)?.state).toBe("locked");
    await f.db.update(schema.matches).set({status:"in_progress",gameplayStartedAt:new Date()}).where(eq(schema.matches.id,f.matchId));
    await f.db.update(schema.matchMaps).set({completedAt:new Date(),scoreA:13,scoreB:7}).where(eq(schema.matchMaps.id,maps[0]!.id));await reconcile();
    const second=(await read(f.db,f.seasonId,f.userId)).markets.filter(m=>m.type==="map_winner");expect(second).toHaveLength(2);expect(second[1]?.state).toBe("open");
    await f.db.update(schema.matchMaps).set({startedAt:new Date(),completedAt:new Date(),scoreA:13,scoreB:9}).where(eq(schema.matchMaps.id,maps[1]!.id));
    await f.db.update(schema.matches).set({status:"finished",scoreA:2,scoreB:0}).where(eq(schema.matches.id,f.matchId));await reconcile();
    expect((await read(f.db,f.seasonId,f.userId)).markets.filter(m=>m.type==="map_winner")).toHaveLength(2);
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.type==="total_rounds" && m.context.startsWith("第3图"))?.state).toBe("refunded");
  }));

  // Deployment can run the old worker between migration and application promotion.
  // Real SQL must prove the scheduler remains due and publication is retried once.
  it("recovers a new catalog even if an older worker consumed dirty before promotion",async()=>fixture(async f=>{
    const original=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
    const [match]=await f.db.insert(schema.matches).values({seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,majorStageRunId:original!.majorStageRunId,stage:"stage1",ownership:"major_stage",managedKey:"rollout-window",format:"bo3"}).returning();
    await f.db.update(schema.betPrograms).set({dirty:false,catalogVersion:3}).where(eq(schema.betPrograms.seasonId,f.seasonId));
    expect((await f.db.execute(sql`select public.scheduler_job_is_due('reconcile-predictions') as due`)).rows[0]!.due).toBe(true);
    expect(await runBetReconciliationJob(f.db)).toBe(1);
    expect((await read(f.db,f.seasonId,f.userId)).markets.filter(m=>m.matchId===match!.id && m.type==="total_rounds" && m.canStake)).toHaveLength(3);
    expect(await f.db.query.betPrograms.findFirst({where:eq(schema.betPrograms.seasonId,f.seasonId)})).toMatchObject({dirty:false,catalogVersion:4});
    expect((await f.db.execute(sql`select public.scheduler_job_is_due('reconcile-predictions') as due`)).rows[0]!.due).toBe(false);
    expect(await runBetReconciliationJob(f.db)).toBe(0);
  }));

  it("publishes all five BO5 totals before BP without reopening earlier format history",async()=>fixture(async f=>{
    const before=await f.db.select().from(schema.betMarkets).where(and(eq(schema.betMarkets.matchId,f.matchId),eq(schema.betMarkets.type,"total_rounds")));
    await f.db.update(schema.matches).set({format:"bo5"}).where(eq(schema.matches.id,f.matchId));
    await f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    const board=await read(f.db,f.seasonId,f.userId);
    expect(before.every(m=>board.markets.find(row=>row.id===m.id)?.state==="refunded")).toBe(true);
    const open=board.markets.filter(m=>m.type==="total_rounds" && m.state==="open");
    expect(open.map(m=>m.context).sort()).toEqual([1,2,3,4,5].map(i=>`第${i}图 · 地图待定`));
    expect(open.every(m=>m.canStake)).toBe(true);
  }));

  // Protect financial identity/terms across BP and real concurrent worker publication.
  // Pure domain tests cannot prove unique pools, immutable options or ledger refunds.
  it("accepts every BO3 slot before BP, freezes invested terms across BP/reschedule and refunds unused stakes once",async()=>fixture(async f=>{
    const {db,seasonId,userId,matchId}=f;
    const reconcile=()=>db.transaction(async tx=>{await lockBetProgram(tx,seasonId);await reconcileBetInTx(tx,seasonId);});
    const before=await db.select().from(schema.betMarkets).where(and(eq(schema.betMarkets.matchId,matchId),eq(schema.betMarkets.type,"total_rounds")));
    expect(before.map(m=>m.subject.kind==="map_slot"?m.subject.mapOrder:0).sort()).toEqual([1,2,3]);
    const board=await read(db,seasonId,userId);
    expect(board.markets.filter(m=>m.type==="total_rounds").every(m=>m.canStake && m.context.includes("地图待定"))).toBe(true);
    const third=board.markets.find(m=>m.context.startsWith("第3图"))!;
    await db.transaction(tx=>stakeBetInTx(tx,{seasonId,userId,marketId:third.id,optionId:third.options[0]!.id,amount:"200",requestId:randomUUID()}));
    await db.update(schema.matches).set({scheduledAt:new Date(Date.now()+86400000),status:"in_progress",startedAt:new Date()}).where(eq(schema.matches.id,matchId));
    await db.insert(schema.matchVetoSessions).values({matchId,startedAt:new Date(),completedAt:new Date(),mapPoolSnapshot:["de_inferno","de_nuke","de_mirage"]});
    const maps=await db.insert(schema.matchMaps).values(["de_inferno","de_nuke","de_mirage"].map((mapName,i)=>({matchId,mapOrder:i+1,mapName}))).returning();
    await Promise.all([reconcile(),reconcile()]);
    expect(await db.select().from(schema.betMarkets).where(and(eq(schema.betMarkets.matchId,matchId),eq(schema.betMarkets.type,"total_rounds")))).toEqual(before);
    expect((await read(db,seasonId,userId)).markets.find(m=>m.id===third.id)).toMatchObject({context:"第3图 · Mirage",canStake:true,pool:"200",mine:{amount:"200"}});
    await db.update(schema.matchMaps).set({mapName:"de_ancient"}).where(eq(schema.matchMaps.id,maps[2]!.id));await reconcile();
    expect((await read(db,seasonId,userId)).markets.find(m=>m.id===third.id)).toMatchObject({context:"第3图 · Ancient",pool:"200"});
    await db.update(schema.matchMaps).set({startedAt:new Date(),completedAt:new Date(),scoreA:13,scoreB:7}).where(eq(schema.matchMaps.id,maps[0]!.id));
    const lock=(await db.query.betMarkets.findFirst({where:eq(schema.betMarkets.id,before.find(m=>m.subject.kind==="map_slot" && m.subject.mapOrder===1)!.id)}))!.lockedAt;
    expect(lock).not.toBeNull(); // SQL outbox, before any reconciliation.
    expect((await read(db,seasonId,userId)).markets.find(m=>m.id===third.id)?.canStake).toBe(true);
    await db.update(schema.matchMaps).set({startedAt:new Date(),completedAt:new Date(),scoreA:13,scoreB:9}).where(eq(schema.matchMaps.id,maps[1]!.id));
    await db.update(schema.matches).set({status:"finished",scoreA:2,scoreB:0}).where(eq(schema.matches.id,matchId));
    await Promise.all([reconcile(),reconcile()]);
    const after=await read(db,seasonId,userId);expect(after.balance).toBe("1000");
    expect(after.markets.find(m=>m.id===third.id)).toMatchObject({state:"refunded",mine:{amount:"200",payout:"200"}});
    expect(after.records.filter(r=>r.label.includes("退款"))).toHaveLength(1);
    expect(after.records.find(r=>r.amount==="-200")?.context).toContain("第3图");
  }));

  it("serializes a prematch slot stake behind its real map-start transaction",async()=>fixture(async f=>{
    const {db,seasonId,userId,matchId}=f;
    const market=(await read(db,seasonId,userId)).markets.find(m=>m.context.startsWith("第2图"))!;
    const [map]=await db.insert(schema.matchMaps).values({matchId,mapOrder:2,mapName:"de_nuke"}).returning();
    let admission:Promise<unknown>|undefined;
    await db.transaction(async writer=>{
      await writer.update(schema.matchMaps).set({startedAt:new Date()}).where(eq(schema.matchMaps.id,map!.id));
      let reportPid!:(pid:number)=>void;const ready=new Promise<number>(resolve=>{reportPid=resolve;});
      admission=db.transaction(async tx=>{
        reportPid(Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]!.pid));
        return stakeBetInTx(tx,{seasonId,userId,marketId:market.id,optionId:market.options[0]!.id,amount:"100",requestId:randomUUID()});
      }).then(()=>null,error=>error);
      const pid=await ready;
      await expect.poll(async()=>Boolean((await db.execute(sql`select cardinality(pg_blocking_pids(${pid})) > 0 as blocked`)).rows[0]!.blocked)).toBe(true);
    });
    expect(await admission).toMatchObject({message:expect.stringMatching(/锁定/)});
    expect((await read(db,seasonId,userId)).balance).toBe("1000");
    expect(await db.select().from(schema.betStakes).where(eq(schema.betStakes.marketId,market.id))).toHaveLength(0);
    expect((await db.query.betMarkets.findFirst({where:eq(schema.betMarkets.id,market.id)}))?.lockedAt).not.toBeNull();
  }));

  it("keeps existing open, locked and settled legacy pools without creating duplicate slots",async()=>fixture(async f=>{
    const {db,seasonId,userId}=f;
    const original=await db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
    const [match]=await db.insert(schema.matches).values({seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,majorStageRunId:original!.majorStageRunId,stage:"stage1",ownership:"major_stage",managedKey:"legacy-pools",format:"bo3"}).returning();
    const maps=await db.insert(schema.matchMaps).values(["de_inferno","de_nuke","de_mirage"].map((mapName,i)=>({matchId:match!.id,mapOrder:i+1,mapName}))).returning();
    const legacy:(typeof schema.betMarkets.$inferSelect)[]=[];
    for(const [i,map] of maps.entries()) {
      const [market]=await db.insert(schema.betMarkets).values({seasonId,matchId:match!.id,marketKey:`legacy/${i}`,type:"total_rounds",line:45,subject:{kind:"map",entryIds:[f.entryIds[0]!,f.entryIds[1]!],runId:original!.majorStageRunId!,format:"bo3",mapId:map.id,mapOrder:map.mapOrder,mapName:map.mapName},lockedAt:i===1?new Date():null}).returning();
      await db.insert(schema.betOptions).values([{marketId:market!.id,key:"over",label:"大",position:0},{marketId:market!.id,key:"under",label:"小",position:1}]);legacy.push(market!);
    }
    for(const [index,viewer,key] of [[0,userId,"over"],[2,userId,"over"],[2,f.otherId,"under"]] as const) {
      const option=await db.query.betOptions.findFirst({where:and(eq(schema.betOptions.marketId,legacy[index]!.id),eq(schema.betOptions.key,key))});
      await db.transaction(tx=>stakeBetInTx(tx,{seasonId,userId:viewer,marketId:legacy[index]!.id,optionId:option!.id,amount:"100",requestId:randomUUID()}));
    }
    await db.transaction(async tx=>{await lockBetProgram(tx,seasonId);await reconcileBetInTx(tx,seasonId);});
    expect(await db.select().from(schema.betMarkets).where(and(eq(schema.betMarkets.matchId,match!.id),eq(schema.betMarkets.type,"total_rounds")))).toEqual(legacy);
    await db.update(schema.matchMaps).set({completedAt:new Date(),scoreA:13,scoreB:7}).where(eq(schema.matchMaps.id,maps[2]!.id));
    await db.transaction(async tx=>{await lockBetProgram(tx,seasonId);await reconcileBetInTx(tx,seasonId);});
    const before=await db.select().from(schema.betMarkets).where(and(eq(schema.betMarkets.matchId,match!.id),eq(schema.betMarkets.type,"total_rounds")));
    const settlements=await db.select().from(schema.betSettlements).where(eq(schema.betSettlements.marketId,legacy[2]!.id));
    expect(settlements.at(-1)?.state).toBe("settled");
    await db.update(schema.matches).set({scheduledAt:new Date(Date.now()+86400000)}).where(eq(schema.matches.id,match!.id));
    await db.transaction(async tx=>{await lockBetProgram(tx,seasonId);await reconcileBetInTx(tx,seasonId);});
    expect(await db.select().from(schema.betMarkets).where(and(eq(schema.betMarkets.matchId,match!.id),eq(schema.betMarkets.type,"total_rounds")))).toEqual(before);
    expect(before).toHaveLength(3);expect(before.every(m=>m.subject.kind==="map" && m.line===45)).toBe(true);
    expect(await db.select().from(schema.betSettlements).where(eq(schema.betSettlements.marketId,legacy[2]!.id))).toEqual(settlements);
    expect((await read(db,seasonId,userId)).markets.filter(m=>m.matchId===match!.id && m.type==="total_rounds")).toHaveLength(3);
  }));

  it("opens automatically without PickEm, ignores schedule, permanently locks at gameplay and conserves pool across correction",async()=>fixture(async f=>{
    const {db,seasonId,userId,otherId,matchId}=f;
    expect(await db.select().from(schema.predictionPrograms)).toHaveLength(0);
    const board=await read(db,seasonId,userId);expect(board.markets.filter(m=>m.matchId===matchId)).toHaveLength(7);
    const m=board.markets.find(m=>m.type==="match_winner")!;
    const args={seasonId,userId,marketId:m.id,optionId:m.options[0]!.id,amount:"200",requestId:randomUUID()};
    await db.transaction(tx=>stakeBetInTx(tx,args));await db.transaction(tx=>stakeBetInTx(tx,args));
    await db.transaction(tx=>stakeBetInTx(tx,{...args,userId:otherId,optionId:m.options[1]!.id,amount:"300",requestId:randomUUID()}));
    await expect(db.transaction(tx=>stakeBetInTx(tx,{...args,optionId:m.options[1]!.id,requestId:randomUUID()}))).rejects.toThrow(/原选项/);
    await db.update(schema.matches).set({status:"in_progress",startedAt:new Date()}).where(eq(schema.matches.id,matchId));
    // BP/roster start alone is not the gameplay boundary.
    await db.transaction(tx=>stakeBetInTx(tx,{...args,amount:"50",requestId:randomUUID()}));
    await db.update(schema.matches).set({gameplayStartedAt:new Date()}).where(eq(schema.matches.id,matchId));
    expect((await read(db,seasonId,userId)).markets.find(x=>x.id===m.id)?.state).toBe("locked");
    await expect(db.transaction(tx=>stakeBetInTx(tx,{...args,requestId:randomUUID()}))).rejects.toThrow(/锁定/);
    await db.update(schema.matches).set({status:"finished",scoreA:2,scoreB:0,completedAt:new Date()}).where(eq(schema.matches.id,matchId));
    const reconcile=()=>db.transaction(async tx=>{await lockBetProgram(tx,seasonId);await reconcileBetInTx(tx,seasonId);});
    await reconcile();expect((await read(db,seasonId,userId)).balance).toBe("1300");expect((await read(db,seasonId,otherId)).balance).toBe("700");
    await reconcile();expect((await read(db,seasonId,userId)).balance).toBe("1300");
    await db.update(schema.matches).set({scoreA:0,scoreB:2}).where(eq(schema.matches.id,matchId));await reconcile();
    expect((await read(db,seasonId,userId)).balance).toBe("750");expect((await read(db,seasonId,otherId)).balance).toBe("1250");
    await expect(db.update(schema.betMarkets).set({lockedAt:null}).where(eq(schema.betMarkets.id,m.id))).rejects.toThrow();
    await expect(db.update(schema.betLedger).set({amount:BigInt(99)})).rejects.toThrow();
    expect((await db.execute(sql`select has_table_privilege('authenticated','bet_stakes','INSERT') as allowed`)).rows[0]?.allowed).toBe(false);
  }));
  it("serializes concurrent ALL IN, validates replay payload, and refunds a forfeit",async()=>fixture(async f=>{
    const m=(await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.type==="total_rounds" && m.context.startsWith("第3图"))!;
    const args={seasonId:f.seasonId,userId:f.userId,marketId:m.id,optionId:m.options[0]!.id,amount:"all",requestId:randomUUID()};
    const results=await Promise.allSettled([f.db.transaction(tx=>stakeBetInTx(tx,args)),f.db.transaction(tx=>stakeBetInTx(tx,{...args,requestId:randomUUID()}))]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const account=await f.db.query.betAccounts.findFirst({where:and(eq(schema.betAccounts.seasonId,f.seasonId),eq(schema.betAccounts.userId,f.userId))});
    expect(await f.db.transaction(tx=>betBalance(tx,account!.id))).toBe(BigInt(0));
    const stake=await f.db.query.betStakes.findFirst({where:eq(schema.betStakes.accountId,account!.id)});
    await expect(f.db.transaction(tx=>stakeBetInTx(tx,{...args,requestId:stake!.requestId,amount:"1000"}))).rejects.toThrow(/重复请求/);
    await f.db.update(schema.matches).set({isForfeit:true,status:"finished",scoreA:2,scoreB:0}).where(eq(schema.matches.id,f.matchId));
    await f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    expect((await read(f.db,f.seasonId,f.userId)).balance).toBe("1000");
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(x=>x.id===m.id)?.state).toBe("refunded");
  }));
  // Existing start/finish tests atomically finalized the series, missing this lag window.
  it("the v2 publisher closes the prematch decider at clinch and never backfills an already decided series",async()=>fixture(async f=>{
    const third=(await f.db.select().from(schema.betMarkets)).find(m=>m.matchId===f.matchId && m.type==="total_rounds" && m.subject.kind==="map_slot" && m.subject.mapOrder===3)!;
    expect(third).toBeDefined();
    await f.db.update(schema.matches).set({status:"in_progress",gameplayStartedAt:new Date()}).where(eq(schema.matches.id,f.matchId));
    await f.db.insert(schema.matchMaps).values([1,2].map(mapOrder=>({matchId:f.matchId,mapOrder,mapName:mapOrder===1?"de_nuke":"de_inferno",completedAt:new Date(),scoreA:13,scoreB:7})));
    expect((await read(f.db,f.seasonId,f.userId)).markets.find(m=>m.id===third.id)).toMatchObject({state:"locked",canStake:false});
    const match=await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)});
    const id=randomUUID();await f.db.insert(schema.matches).values({...match!,id,managedKey:"3:0"});
    await f.db.insert(schema.matchMaps).values([1,2].map(mapOrder=>({matchId:id,mapOrder,mapName:mapOrder===1?"de_nuke":"de_inferno",completedAt:new Date(),scoreA:7,scoreB:13})));
    await f.db.transaction(async tx=>{await lockBetProgram(tx,f.seasonId);await reconcileBetInTx(tx,f.seasonId);});
    const all=await f.db.select().from(schema.betMarkets);
    expect(all.filter(m=>m.matchId===id && m.type==="total_rounds")).toHaveLength(0);
    expect(await f.db.query.betSettlements.findFirst({where:eq(schema.betSettlements.marketId,third.id)})).toMatchObject({state:"pending"});
    expect((await f.db.query.betMarkets.findFirst({where:eq(schema.betMarkets.id,third.id)}))!.voidedAt).toBeNull();
  }));

});
