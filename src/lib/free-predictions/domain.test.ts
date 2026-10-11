import { describe,it,expect } from "vitest";
import { gradePrediction, freePredictionRestriction } from "./domain";
import type { MarketFactInput } from "@/lib/bet/domain";
const base:MarketFactInput={type:"match_winner",subject:{kind:"match",entryIds:["a","b"],runId:"run",format:"bo3",mapPool:["de_a","de_b","de_c","de_d","de_e","de_f","de_g"]},line:null,voidedAt:null,
  match:{id:"m",entryAId:"a",entryBId:"b",majorStageRunId:"run",qualificationRunId:null,format:"bo3",status:"finished",isForfeit:false,startedAt:new Date(),scoreA:2,scoreB:0},
  maps:["de_a","de_b","de_c"].map((mapName,i)=>({id:String(i),matchId:"m",mapOrder:i+1,mapName,startedAt:null,completedAt:null,scoreA:null,scoreB:null})),
  veto:{startedAt:new Date(),completedAt:new Date(),pendingAppeal:false,mapPoolSnapshot:["de_a","de_b","de_c","de_d","de_e","de_f","de_g"]},event:{entryIds:[],playerIds:[],started:false,champion:null,kills:null}};
describe("free prediction canonical projection",()=>{
  it("grades full BP even when third map never played, suspends on appeal and restores corrected facts",()=>{
    expect(gradePrediction("bp",["de_c","de_a","de_b"],base)).toMatchObject({state:"correct",hits:3,total:3});
    expect(gradePrediction("bp",["de_a","de_b","de_c"],{...base,veto:{...base.veto!,pendingAppeal:true}}).state).toBe("pending");
    expect(gradePrediction("bp",["de_a","de_b","de_c"],{...base,maps:base.maps.slice(0,2)}).state).toBe("void");
    expect(gradePrediction("result",["a"],{...base,match:undefined}).state).toBe("void");
  });
  it("explains cancellation, finality and eligibility without confusing them with the start fence",()=>{
    const open={status:"scheduled" as const,isForfeit:false,seasonStatus:"playing",signedIn:true,active:true,verified:true,locked:false,validMapPool:true};
    expect(freePredictionRestriction(open)).toBeNull();
    expect(freePredictionRestriction({...open,status:"cancelled",locked:true})?.code).toBe("cancelled");
    expect(freePredictionRestriction({...open,status:"finished",locked:true})?.code).toBe("finished");
    expect(freePredictionRestriction({...open,locked:true,signedIn:false})?.code).toBe("started");
    expect(freePredictionRestriction({...open,verified:false})?.code).toBe("verify_email");
  });

});
