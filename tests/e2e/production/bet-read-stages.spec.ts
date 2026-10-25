import { test } from "../fixtures";
import { verifyBetReadStages } from "../helpers/bet-read-stages";

test.use({scenarioProfile:"auth"});
test.setTimeout(180000);
test("production BET open/mine/event preserve anonymous and joined snapshots",async({page,context,scenario,request},info)=>{
  await verifyBetReadStages({page,context,scenario,request},info,true);
});
