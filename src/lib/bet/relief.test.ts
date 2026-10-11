import { describe, expect, it } from "vitest";
import { projectBetRelief, type BetReliefFacts } from "./relief";
const base: BetReliefFacts = {day:"2026-10-12", loggedIn:true, activeVerified:true, enabled:true, paused:false, seasonOpen:true, joined:true, balance:BigInt(0), granted:BigInt(0), claimedToday:false};
describe("finite BET relief policy", () => {
  it.each([[BigInt(0),"10"],[BigInt(3),"7"],[BigInt(9),"1"],[BigInt(10),"0"],[-BigInt(1),"0"]])("bounds the grant for balance %s", (balance, amount) => {
    expect(projectBetRelief({...base,balance}).amount).toBe(amount);
  });
  it("caps only relief grant and refuses all unsafe or repeated claims", () => {
    expect(projectBetRelief({...base, granted:BigInt(99)})).toMatchObject({canClaim:true,amount:"1",remaining:"1"});
    for (const [patch,reason] of [
      [{loggedIn:false},"login_required"], [{activeVerified:false},"account_invalid"], [{enabled:false},"disabled"],
      [{paused:true},"paused"], [{seasonOpen:false},"season_closed"], [{joined:false},"join_required"],
      [{balance:-BigInt(1)},"debt"], [{claimedToday:true},"claimed_today"], [{granted:BigInt(100)},"limit_reached"], [{balance:BigInt(10)},"balance_sufficient"],
    ] as const) expect(projectBetRelief({...base,...patch})).toMatchObject({reason,canClaim:false,amount:"0"});
  });
});
