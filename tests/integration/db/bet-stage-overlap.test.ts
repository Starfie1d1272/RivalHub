import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { TxDb } from "@/db/client";
import { fixture } from "./harness/bet-fixture";
import { readUnifiedBetSnapshot, projectUnifiedBetBoard, completeUnifiedBetSnapshot } from "@/lib/bet/board-read";
import { readBetPublicStats, type BetPublicStats } from "@/lib/bet/public-stats-read";
import { readBetBoardStages } from "@/lib/bet/board-stages";
import { preserveBetPublicFillFailure } from "@/lib/bet/public-stats-failure";
import { submitFreePredictionInTx } from "@/lib/free-predictions/service";

const cache = vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/bet/public-stats-cache",()=>({getBetPublicStats:cache.read}));

// Real PG snapshots and query footprints; cache lifecycle is controlled here,
// not evidence of Next handler hit/expiry. No synthetic SQL latency is injected.
it("overlaps isolated public/private reads, preserves all six views and falls back as one fresh snapshot",async()=>fixture(async f=>{
  const season=(await f.db.query.seasons.findFirst({where:eq(schema.seasons.id,f.seasonId)}))!;
  const unjoined=randomUUID();
  await f.db.insert(schema.users).values({id:unjoined,email:`${unjoined}@example.test`,emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration"});
  const match=(await f.db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)}))!;
  // Hidden terminal history remains in the shared free-fact signature even
  // though open market candidates no longer include its options/private rows.
  const historyMatchId=randomUUID(),historyMarketId=randomUUID();
  const market=(await f.db.query.betMarkets.findMany({where:eq(schema.betMarkets.matchId,f.matchId)})).find(m=>m.type==="match_winner")!;
  await f.db.insert(schema.matches).values({id:historyMatchId,seasonId:f.seasonId,entryAId:f.entryIds[0]!,entryBId:f.entryIds[1]!,stage:"stage1",majorStageRunId:match.majorStageRunId,ownership:"major_stage",managedKey:"stage-history",round:1,format:"bo3",status:"finished",scoreA:2,scoreB:0});
  await f.db.insert(schema.betMarkets).values({...market,id:historyMarketId,matchId:historyMatchId,marketKey:"stage-history"});
  const choices=await f.db.query.betOptions.findMany({where:eq(schema.betOptions.marketId,market.id)});
  const historyOptionId=randomUUID();
  await f.db.insert(schema.betOptions).values(choices.map((option,i)=>({...option,id:i===0?historyOptionId:randomUUID(),marketId:historyMarketId})));
  await f.db.insert(schema.betSettlements).values({marketId:historyMarketId,revision:1,state:"settled",fingerprint:"stage-history",winningOptionIds:[historyOptionId]});
  const voters=Array.from({length:40},()=>randomUUID());
  await f.db.insert(schema.users).values(voters.map(id=>({id,email:`${id}@example.test`}))); 
  await f.db.insert(schema.freePredictionChoices).values(voters.map((userId,i)=>({seasonId:f.seasonId,matchId:f.matchId,userId,kind:"result" as const,selection:[f.entryIds[i%2]!],subject:{entryIds:f.entryIds as [string,string],runId:match.majorStageRunId!,format:"bo3" as const,mapPool:[]}})));
  await f.db.transaction(tx=>submitFreePredictionInTx(tx,{seasonId:f.seasonId,matchId:f.matchId,userId:f.userId,kind:"result",selection:[f.entryIds[0]!],requestId:randomUUID()}));
  const clients=await Promise.all([f.db.$client.connect(),f.db.$client.connect()]);
  const footprint=[{queries:0,rows:0,bytes:0},{queries:0,rows:0,bytes:0}];
  const originals=clients.map(client=>client.query);
  clients.forEach((client,i)=>{client.query=((...args:unknown[])=>Promise.resolve(Reflect.apply(originals[i]!,client,args)).then(value=>{
    if(value.command==="SELECT"){footprint[i]!.queries++;footprint[i]!.rows+=value.rows.length;footprint[i]!.bytes+=Buffer.byteLength(JSON.stringify(value.rows));}return value;
  })) as typeof client.query;});
  const [publicDb,privateDb]=clients.map(client=>drizzle(client,{schema}));
  const transaction=<T>(db:typeof privateDb,work:(tx:TxDb)=>Promise<T>)=>db!.transaction(work,{accessMode:"read only",isolationLevel:"repeatable read"});
  try {
    const report:unknown[]=[];
    for(const view of ["open","mine","settled","event","leaderboard","records"]){
      const scope={view,recordsPage:0};
      const publicScope={includeEvent:["mine","settled","event"].includes(view),includeFree:view!=="event",view:view==="event"?"event" as const:undefined};
      for(const [viewer,userId] of [["anonymous",null],["joined",f.userId],["unjoined",unjoined]] as const){
        for(const state of ["cold","warm","invalidated"]){
          const skip=["leaderboard","records"].includes(view);
          const cached=state==="warm" && !skip ? await transaction(publicDb,tx=>readBetPublicStats(tx,f.seasonId,publicScope)):undefined;
          let publicMs=0,privateMs=0;
          cache.read.mockImplementation(async()=>{
            const started=performance.now();
            const value=cached??await transaction(publicDb,tx=>readBetPublicStats(tx,f.seasonId,publicScope));
            publicMs+=performance.now()-started;return value;
          });
          const read=async(stats:BetPublicStats|"deferred"|undefined)=>{
            const started=performance.now();
            const board=await transaction(privateDb,tx=>readUnifiedBetSnapshot(tx,f.seasonId,userId,scope,stats));
            privateMs+=performance.now()-started;return {board};
          };
          const measure=async(parallel:boolean)=>{
            footprint.forEach(row=>Object.assign(row,{queries:0,rows:0,bytes:0}));publicMs=0;privateMs=0;
            const start=performance.now();
            const modes:unknown[]=[];
            const data=parallel?await readBetBoardStages(season,scope,stats=>{modes.push(stats);return read(stats);}):await read(skip?undefined:await cache.read());
            if(parallel)expect(modes).toEqual([skip?undefined:"deferred"]);
            const projectionStart=performance.now(),value=projectUnifiedBetBoard(data.board);
            return {value,publicMs,privateMs,projectionMs:performance.now()-projectionStart,wallMs:performance.now()-start,public:{...footprint[0]},private:{...footprint[1]},dtoBytes:Buffer.byteLength(JSON.stringify(value))};
          };
          const nextFirst:boolean=report.length % 2 === 1;
          const first=await measure(nextFirst),second=await measure(!nextFirst);
          const old=nextFirst?second:first,next=nextFirst?first:second;
          expect(next.value).toEqual(old.value);
          expect(next.private.queries).toBe(old.private.queries);
          if(skip){expect(next.public.queries).toBe(0);expect(next.value.bet.markets).toEqual([]);expect(next.value.free.matches).toEqual([]);}
          if(!userId){expect(next.value.bet.markets.every(m=>!m.canStake && !m.mine)).toBe(true);}
          report.push({view,viewer,state,nextFirst,old:{...old,value:undefined},next:{...next,value:undefined}});
        }
      }
    }
    console.info("BET_STAGE_REAL_PG_AB",JSON.stringify(report));

    // Hold only the cache result: the private transaction must commit before
    // release, proving it does not retain a connection while awaiting cache.
    const stats=await transaction(publicDb,tx=>readBetPublicStats(tx,f.seasonId,{includeEvent:false,includeFree:true}));
    let release!:(value:BetPublicStats)=>void;
    cache.read.mockImplementationOnce(()=>new Promise<BetPublicStats>(resolve=>{release=resolve;}));
    let committed!:()=>void;
    const privateDone=new Promise<void>(resolve=>{committed=resolve;});
    const read=async(aggregates:BetPublicStats|"deferred"|undefined)=>{
      const board=await transaction(privateDb,tx=>readUnifiedBetSnapshot(tx,f.seasonId,f.userId,{view:"open"},aggregates));committed();return {board};
    };
    const pending=readBetBoardStages(season,{view:"open"},read);
    await privateDone;release(stats);
    expect(projectUnifiedBetBoard((await pending).board).free.matches[0]!.result.mine).toBe(f.entryIds[0]);
    const deferred=await transaction(privateDb,tx=>readUnifiedBetSnapshot(tx,f.seasonId,f.userId,{view:"open"},"deferred"));
    expect(()=>projectUnifiedBetBoard(deferred)).toThrow("not ready");
    await f.db.update(schema.matches).set({entryAId:f.entryIds[1]!,entryBId:f.entryIds[0]!}).where(eq(schema.matches.id,f.matchId));
    const corrected=await transaction(privateDb,tx=>readUnifiedBetSnapshot(tx,f.seasonId,f.userId,{view:"open"},"deferred"));
    expect(completeUnifiedBetSnapshot(corrected,stats)).toBeUndefined();
    cache.read.mockResolvedValue(stats);
    const modes:unknown[]=[];
    const recovered=await readBetBoardStages(season,{view:"open"},async mode=>{modes.push(mode);return read(mode);});
    expect(modes).toEqual(["deferred",undefined]);
    expect(projectUnifiedBetBoard(recovered.board)).toEqual(projectUnifiedBetBoard((await read(undefined)).board));
    expect(projectUnifiedBetBoard(recovered.board).free.matches[0]!.result.support.total).toBe(0);
    // Transport failure discards the deferred private snapshot; DB failures still propagate.
    cache.read.mockRejectedValueOnce(Object.assign(new Error("cache disconnected"),{code:"ECONNRESET"}));
    const failureModes:unknown[]=[];
    const fallback=await readBetBoardStages(season,{view:"open"},async mode=>{failureModes.push(mode);return read(mode);});
    expect(failureModes).toEqual(["deferred",undefined]);
    expect(projectUnifiedBetBoard(fallback.board)).toEqual(projectUnifiedBetBoard((await read(undefined)).board));
    cache.read.mockRejectedValueOnce(Object.assign(new Error("cache disconnected"),{code:"ECONNRESET"}));
    const dbError=new Error("private database failure");
    await expect(readBetBoardStages(season,{view:"open"},async()=>{throw dbError;})).rejects.toBe(dbError);
    cache.read.mockRejectedValueOnce(Object.assign(new Error("cache disconnected"),{code:"ECONNRESET"}));
    await expect(readBetBoardStages(season,{view:"open"},async mode=>{if (mode === undefined) throw dbError; return read(mode);})).rejects.toBe(dbError);
    let fillError:unknown; try { preserveBetPublicFillFailure(Object.assign(new Error("database disconnected"),{code:"ECONNRESET"})); } catch (error) { fillError=error; }
    cache.read.mockRejectedValueOnce(fillError);
    await expect(readBetBoardStages(season,{view:"open"},read)).rejects.toBe(fillError);
    cache.read.mockRejectedValueOnce(new Error("unexpected cache bug"));
    await expect(readBetBoardStages(season,{view:"open"},read)).rejects.toThrow("unexpected cache bug");
    // Authorized drafts retain their uncached complete snapshot path.
    cache.read.mockClear();
    const draftModes:unknown[]=[];
    await readBetBoardStages({...season,status:"draft"},{view:"open"},mode=>{draftModes.push(mode);return read(mode);});
    expect(draftModes).toEqual([undefined]);expect(cache.read).not.toHaveBeenCalled();
  }finally{clients.forEach((client,i)=>{client.query=originals[i]!;client.release();});}
}));
