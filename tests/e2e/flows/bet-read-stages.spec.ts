import { test } from "../fixtures";
import { verifyBetReadStages } from "../helpers/bet-read-stages";

test.use({scenarioProfile:"auth"});
test.setTimeout(240000);
// This GET/RSC privacy matrix has no viewport-dependent branch. Run it once,
// matching bet.spec.ts/free-predictions.spec.ts; production smoke keeps both.
test.skip(({isMobile})=>!isMobile,"BET transport contract runs once on mobile; production smoke covers both viewports");
// Controlled tag invalidation complements the real-PG stage benchmark.
test("BET six views retain anonymous/unjoined/joined privacy after public tag invalidation",async({page,context,scenario,request},info)=>{
  await verifyBetReadStages({page,context,scenario,request},info);
});
