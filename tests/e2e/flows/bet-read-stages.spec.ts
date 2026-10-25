import { test } from "../fixtures";
import { verifyBetReadStages } from "../helpers/bet-read-stages";

test.use({scenarioProfile:"auth"});
test.setTimeout(240000);
// GET/RSC privacy has no viewport-dependent branch. Production keeps both.
test.skip(({isMobile})=>!isMobile,"BET transport contract runs once on mobile; production smoke covers both viewports");
// Keep all 54 cells while letting the existing workers share the six views.
for(const view of ["open","mine","settled","event","leaderboard","records"]){
  test(`BET ${view} retains anonymous/unjoined/joined privacy after tag invalidation`,async({page,context,scenario,request},info)=>{
    await verifyBetReadStages({page,context,scenario,request},info,false,[view]);
  });
}
