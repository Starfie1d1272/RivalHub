import { describe, expect, it } from "vitest";
import { completedVetoMaps } from "@/lib/matches/veto-result";
import { resolveBetFact, type MarketFactInput } from "@/lib/bet/domain";
import { gradePrediction } from "@/lib/free-predictions/domain";

const pool = ["de_ancient","de_anubis","de_cache","de_inferno","de_mirage","de_nuke","de_overpass"];
const answer = ["de_mirage","de_ancient","de_cache"];
function input(): MarketFactInput {
  return { type:"veto_present",line:null,voidedAt:null,subject:{kind:"match",entryIds:["a","b"],runId:"run",format:"bo3",mapPool:pool},
    match:{id:"match",entryAId:"a",entryBId:"b",majorStageRunId:"run",qualificationRunId:null,format:"bo3",status:"finished",isForfeit:false,startedAt:new Date(),scoreA:2,scoreB:0},
    maps:answer.slice(0,2).map((mapName,index)=>({id:String(index),matchId:"match",mapOrder:index+1,mapName,startedAt:new Date(),completedAt:new Date(),scoreA:13,scoreB:7})),
    veto:{startedAt:new Date(),completedAt:new Date(),pendingAppeal:false,mapPoolSnapshot:pool,steps:answer.map((mapName,index)=>({stepOrder:index+3,actionType:index===2?"decider":"pick",mapName}))},
    event:{entryIds:[],playerIds:[],started:true,champion:null,kills:null} };
}
describe("official completed BP result", () => {
  for (const scoreB of [0,1]) it(`settles the same complete plan for BO3 2:${scoreB}, including an unplayed decider`, () => {
    const f=input();f.match!.scoreB=scoreB;
    if(scoreB)f.maps.push({...f.maps[0]!,id:"third",mapOrder:3,mapName:answer[2]!,scoreA:7,scoreB:13});
    expect(resolveBetFact(f)).toMatchObject({state:"confirmed",winningKeys:[...answer].sort()});
    expect(gradePrediction("bp",[...answer].reverse(),f)).toMatchObject({state:"correct",hits:3,total:3,answer});
    expect(resolveBetFact({...f,type:"veto_decider"})).toMatchObject({state:"confirmed",winningKeys:["de_cache"]});
  });
  it("uses BP corrections independently of played map rows and ignores order for presence winnings", () => {
    const f=input();const before=resolveBetFact(f);
    f.veto!.steps[2]!.mapName="de_nuke";
    expect(resolveBetFact(f)).toMatchObject({state:"confirmed",winningKeys:["de_ancient","de_mirage","de_nuke"]});
    expect(gradePrediction("bp",answer,f)).toMatchObject({state:"incorrect",hits:2});
    f.veto!.steps[2]!.mapName="de_cache";
    [f.veto!.steps[0]!.mapName,f.veto!.steps[1]!.mapName]=[f.veto!.steps[1]!.mapName,f.veto!.steps[0]!.mapName];
    expect(resolveBetFact(f)).toEqual(before);
  });
  for (const invalid of ["incomplete","appeal","missing","duplicate","outside","two-deciders","decider-before-pick"] as const) it(`keeps ${invalid} BP pending even when match_maps look complete`, () => {
    const f=input();f.maps.push({...f.maps[0]!,id:"third",mapOrder:3,mapName:answer[2]!});
    if(invalid==="incomplete")f.veto!.completedAt=null;
    if(invalid==="appeal")f.veto!.pendingAppeal=true;
    if(invalid==="missing")f.veto!.steps=[];
    if(invalid==="duplicate")f.veto!.steps[2]!.mapName=answer[0]!;
    if(invalid==="outside")f.veto!.steps[2]!.mapName="de_dust2";
    if(invalid==="two-deciders")f.veto!.steps[0]!.actionType="decider";
    if(invalid==="decider-before-pick")f.veto!.steps[2]!.stepOrder=1;
    expect(resolveBetFact(f)).toMatchObject({state:"pending"});
    expect(gradePrediction("bp",answer,f)).toMatchObject({state:"pending",hits:null});
  });
  for(const format of ["bo1","bo5"] as const) it(`preserves the ${format} official ordered plan`,()=>{
    const count=Number(format.slice(2));const selected=pool.slice(0,count);
    const veto={...input().veto!,steps:selected.map((mapName,index)=>({stepOrder:index+1,actionType:index===count-1?"decider":"pick",mapName}))};
    expect(completedVetoMaps(format,"a",veto)).toEqual(selected);
  });
});
