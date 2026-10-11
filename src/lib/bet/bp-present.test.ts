import { describe, expect, it } from "vitest";
import { marketIsLocked, resolveBetFact, type MarketFactInput } from "./domain";
import { distributePool } from "./pool";

const pool = Array.from({length:7},(_,i)=>`de_${i}`);
const input: MarketFactInput = {
  type:"veto_present", subject:{kind:"match",entryIds:["a","b"],runId:"run",format:"bo3",mapPool:pool},
  line:null,voidedAt:null, match:{id:"match",entryAId:"a",entryBId:"b",majorStageRunId:"run",qualificationRunId:null,format:"bo3",status:"scheduled",isForfeit:false,startedAt:null,scoreA:null,scoreB:null},
  maps:pool.slice(0,3).map((mapName,i)=>({id:`map${i}`,matchId:"match",mapOrder:i+1,mapName,startedAt:null,completedAt:null,scoreA:null,scoreB:null})),
  veto:{startedAt:new Date(),completedAt:new Date(),pendingAppeal:false,mapPoolSnapshot:pool},
  event:{entryIds:[],playerIds:[],started:false,champion:null,kills:null},
};

// Protect the new answer contract and integer conservation; old single-winner
// evidence cannot detect silently treating veto_present as a first-map market.
describe("BO3 BP presence reader",()=>{
  it("confirms the complete unordered BP set including an unplayed decider",()=>{
    expect(resolveBetFact(input)).toMatchObject({state:"confirmed",winningKeys:pool.slice(0,3)});
    const reordered = input.maps.map((m,i)=>({...m,mapOrder:3-i}));
    expect(resolveBetFact({...input,maps:reordered})).toEqual(resolveBetFact(input));
    expect(marketIsLocked(input)).toBe(true);
    expect(resolveBetFact({...input,match:{...input.match!,status:"finished",scoreA:2,scoreB:0}})).toEqual(resolveBetFact(input));
    for(const type of ["veto_first","veto_decider"] as const)
      expect(resolveBetFact({...input,type})).toMatchObject({winningKeys:[type==="veto_first"?pool[0]:pool[2]]});
  });
  it("waits for complete legal BP and appeals, refunds incompatible terms",()=>{
    for(const changed of [
      {veto:{...input.veto!,completedAt:null}}, {veto:{...input.veto!,pendingAppeal:true}},
      {maps:input.maps.slice(0,2)}, {maps:[...input.maps,{...input.maps[0]!,id:"extra",mapOrder:4}]},
      {maps:input.maps.map(m=>({...m,mapName:pool[0]!}))},
      {maps:input.maps.map(m=>({...m,mapOrder:1}))},
      {maps:input.maps.map(m=>({...m,mapName:"outside"}))},
    ]) expect(resolveBetFact({...input,...changed}).state).toBe("pending");
    for(const changed of [{match:{...input.match!,format:"bo5" as const}}, {match:{...input.match!,isForfeit:true}}, {match:{...input.match!,status:"cancelled" as const}}, {subject:{...input.subject,kind:"match" as const,entryIds:["a","b"] as [string,string],runId:"run",format:"bo3" as const,mapPool:pool.slice(0,6)}}])
      expect(resolveBetFact({...input,...changed}).state).toBe("void");
  });
  it("conserves every 3-of-7 pool exactly with deterministic rounding and refunds",()=>{
    for(let a=0;a<5;a++) for(let b=a+1;b<6;b++) for(let c=b+1;c<7;c++) {
      const positions=pool.map((optionId,i)=>({accountId:`account${i}`,optionId,stake:BigInt(i+1)}));
      const winners=[pool[a]!,pool[b]!,pool[c]!];
      const payout=distributePool(positions,winners);
      expect([...payout.values()].reduce((n,v)=>n+v,BigInt(0))).toBe(BigInt(28));
      expect(distributePool([...positions].reverse(),[...winners].reverse())).toEqual(payout);
      for(const p of positions) {
        if(winners.includes(p.optionId)) expect(payout.get(p.accountId)!).toBeGreaterThanOrEqual(p.stake);
        else expect(payout.get(p.accountId)).toBe(BigInt(0));
      }
    }
    const positions=[{accountId:"a",optionId:pool[0]!,stake:BigInt(1)},{accountId:"b",optionId:pool[1]!,stake:BigInt(2)}];
    for(const winners of [null,[],pool.slice(3,6),pool.slice(0,3)])
      expect(distributePool(positions,winners)).toEqual(new Map([["a",BigInt(1)],["b",BigInt(2)]]));
    expect(distributePool([],pool.slice(0,3)).size).toBe(0);
  });
});
