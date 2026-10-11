import { describe,it,expect } from "vitest";
import { marketIsLocked,resolveBetFact,type MarketFactInput } from "./domain";
import { marketContext } from "./presentation";
import { roundLineTwice } from "./policy";
const base:MarketFactInput={type:"match_winner",subject:{kind:"match",entryIds:["a","b"],runId:"q",format:"bo3",mapPool:[]},line:null,voidedAt:null,match:{id:"m",entryAId:"a",entryBId:"b",majorStageRunId:null,qualificationRunId:"q",format:"bo3",status:"in_progress",isForfeit:false,startedAt:null,scoreA:null,scoreB:null},maps:[],veto:{startedAt:new Date(),completedAt:null,mapPoolSnapshot:["de_a","de_b","de_c"],pendingAppeal:false},event:{entryIds:[],playerIds:[],started:false,champion:null,kills:null}};
describe("BET canonical lifecycle",()=>{
  it("BP does not lock series markets, actual gameplay does",()=>{expect(marketIsLocked(base)).toBe(false);expect(marketIsLocked({...base,type:"veto_first"})).toBe(true);expect(marketIsLocked({...base,match:{...base.match!,startedAt:new Date()}})).toBe(true);});
  it("locks each map independently after previous map completion",()=>{const m={id:"map2",matchId:"m",mapOrder:2,mapName:"de_a",startedAt:null,completedAt:null,scoreA:null,scoreB:null};const input:MarketFactInput={...base,type:"map_winner",subject:{kind:"map",entryIds:["a","b"],runId:"q",format:"bo3",mapId:m.id,mapOrder:2,mapName:m.mapName},match:{...base.match!,startedAt:new Date()},maps:[m]};expect(marketIsLocked(input)).toBe(false);expect(marketIsLocked({...input,maps:[{...m,startedAt:new Date()}]})).toBe(true);});
  it("BP waits for appeals and decider settles without being played",()=>{const input={...base,type:"veto_decider" as const,veto:{...base.veto!,completedAt:new Date(),pendingAppeal:true},maps:[{id:"last",matchId:"m",mapOrder:3,mapName:"de_c",startedAt:null,completedAt:null,scoreA:null,scoreB:null}]};expect(resolveBetFact(input).state).toBe("pending");expect(resolveBetFact({...input,veto:{...input.veto,pendingAppeal:false}})).toMatchObject({state:"confirmed",winningKeys:["de_c"]});});
  it("refunds forfeit, missing match, and frozen subject mismatch",()=>{for(const input of [{...base,match:undefined},{...base,match:{...base.match!,isForfeit:true}},{...base,match:{...base.match!,entryBId:"c"}}])expect(resolveBetFact(input).state).toBe("void");});
  it("settles O/U including overtime, returns to pending on unconfirmed result",()=>{const map={id:"map",matchId:"m",mapOrder:1,mapName:"de_a",startedAt:new Date(),completedAt:new Date(),scoreA:16,scoreB:14};const input:MarketFactInput={...base,type:"total_rounds",line:43,subject:{kind:"map",entryIds:["a","b"],runId:"q",format:"bo3",mapId:map.id,mapOrder:1,mapName:map.mapName},maps:[map]};expect(resolveBetFact(input)).toMatchObject({state:"confirmed",winningKeys:["over"]});expect(resolveBetFact({...input,maps:[{...map,completedAt:null}]}).state).toBe("pending");});
  it("top fraggers require complete statistics and split ties",()=>{const input:MarketFactInput={...base,type:"top_fragger",subject:{kind:"event",entryIds:["a","b"],playerIds:["p","q"]},event:{entryIds:["a","b"],playerIds:["p","q"],started:true,champion:"a",kills:null}};expect(resolveBetFact(input).state).toBe("pending");expect(resolveBetFact({...input,event:{...input.event,kills:[{userId:"p",kills:90},{userId:"q",kills:90}]}})).toMatchObject({state:"confirmed",winningKeys:["p","q"]});});
  it("creates deterministic half lines with a sample fallback",()=>{expect(roundLineTwice([],[])).toBe(43);expect(roundLineTwice([22,20,25],[13,13,13])).toBe(43);expect(roundLineTwice([25],[24,22,20])).toBe(43);});
});

// Legacy tests bind actual map IDs; they cannot protect participation before BP.
// Pure evidence owns slot identity/lock/result boundaries; PostgreSQL owns frozen pools and races.
describe("prematch total-round slots",()=>{
  const subject = {kind:"map_slot" as const,entryIds:["a","b"] as [string,string],runId:"q",format:"bo3" as const,mapOrder:2};
  const input: MarketFactInput = {...base,type:"total_rounds",subject,line:43};
  const map = {id:"map2",matchId:"m",mapOrder:2,mapName:"de_nuke",startedAt:null,completedAt:null,scoreA:null,scoreB:null};
  it("opens without maps throughout BP and names the slot without changing terms",()=>{
    expect(marketIsLocked(input)).toBe(false);
    expect(resolveBetFact(input).state).toBe("pending");
    expect(marketContext(subject,[])).toBe("第2图 · 地图待定");
    expect(marketContext(subject,[map])).toBe("第2图 · Nuke");
    expect(marketIsLocked({...input,veto:{...base.veto!,pendingAppeal:true},maps:[map]})).toBe(false);
    expect(marketIsLocked({...input,maps:[{...map,id:"replaced",mapName:"de_inferno"}]})).toBe(false);
  });
  it("locks only gameplay for this slot or a later slot, first slot also follows series gameplay",()=>{
    const startedAt=new Date();
    expect(marketIsLocked({...input,match:{...base.match!,startedAt},maps:[{...map,mapOrder:1,startedAt}]})).toBe(false);
    for(const mapOrder of [2,3])expect(marketIsLocked({...input,maps:[{...map,mapOrder,startedAt}]})).toBe(true);
    expect(marketIsLocked({...input,subject:{...subject,mapOrder:1},match:{...base.match!,startedAt}})).toBe(true);
  });
  it("settles overtime by order, refunds unused slots and invalid match identities",()=>{
    expect(resolveBetFact({...input,maps:[{...map,id:"new-map",mapName:"de_inferno",completedAt:new Date(),scoreA:16,scoreB:14}]})).toMatchObject({state:"confirmed",winningKeys:["over"]});
    for(const changed of [{status:"finished" as const},{status:"cancelled" as const},{isForfeit:true},{entryBId:"c"},{format:"bo1" as const},{qualificationRunId:"other"}])expect(resolveBetFact({...input,match:{...base.match!,...changed}}).state).toBe("void");
    expect(resolveBetFact({...input,subject:{...subject,mapOrder:4}}).state).toBe("void");
  });
});

// Delayed series finalization must close admission without inventing an early refund.
describe("confirmed series clinch before finalization",()=>{
  for (const [format,target] of [["bo3",2],["bo5",3]] as const) {
    it(`${format}: locks an unused slot at either team's clinch, keeps result pending`,()=>{
      const order=target+1;
      const subject={kind:"map_slot" as const,entryIds:["a","b"] as [string,string],runId:"q",format,mapOrder:order};
      for (const winningSide of ["a","b"]) {
        const maps=Array.from({length:target},(_,i)=>({id:`map${i+1}`,matchId:"m",mapOrder:i+1,mapName:"de_nuke",startedAt:null,completedAt:new Date(),scoreA:winningSide==="a"?13:7,scoreB:winningSide==="b"?13:7}));
        const input:MarketFactInput={...base,type:"total_rounds",subject,line:43,match:{...base.match!,format},maps};
        expect(marketIsLocked(input)).toBe(true);
        expect(resolveBetFact(input).state).toBe("pending");
        expect(marketIsLocked({...input,maps:maps.slice(0,-1)})).toBe(false);
        expect(resolveBetFact({...input,match:{...input.match!,status:"finished"}}).state).toBe("void");
      }
    });
  }
});
