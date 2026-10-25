import { test } from "../fixtures";
import { verifyBetReadStages } from "../helpers/bet-read-stages";

test.use({scenarioProfile:"auth"});
test.setTimeout(240000);
// Controlled tag invalidation complements the real-PG stage benchmark.
test("BET six views retain anonymous/unjoined/joined privacy after public tag invalidation",async({page,context,scenario,request},info)=>{
  await verifyBetReadStages({page,context,scenario,request},info);
});
