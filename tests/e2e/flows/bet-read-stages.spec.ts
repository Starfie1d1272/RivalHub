import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { test,expect,signInProgrammatically } from "../fixtures";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { createPredictionBrowserFixture,removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import * as schema from "@/db/schema";

test.use({scenarioProfile:"auth"});
test.setTimeout(240000);
// Browser transport evidence complements the controlled-cache real PG benchmark.
// updateTag is exercised through canonical admin actions, never a test-only API.
test("BET six views retain anonymous/unjoined/joined privacy after public tag invalidation",async({page,context,scenario,request},info)=>{
  const user=scenario.accounts[0]!;
  const fixture=await createPredictionBrowserFixture(user.userId);
  const pool=new Pool({connectionString:assertLocalDatabaseUrl(process.env.DATABASE_URL),ssl:false});
  const db=drizzle(pool,{schema});
  const admin=await context.newPage();
  try{
    await db.insert(schema.seasonAdminGrants).values({seasonId:fixture.seasonId,userId:user.userId});
    await signInProgrammatically(page,user,scenario,`/admin/${fixture.slug}/bet`);
    await admin.goto(`/admin/${fixture.slug}/bet`);
    async function operate(label:string){
      await admin.getByRole("button",{name:label,exact:true}).click();
      const confirmation=admin.getByRole("region",{name:"BET 操作确认",exact:true});
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button",{name:label,exact:true}).click();
      await expect(confirmation).toHaveCount(0);
    }
    await operate("启用 BET");
    await expect(admin.getByRole("button",{name:"暂停投入",exact:true})).toBeVisible();
    // Compile each route before recording transport timings; these are next dev
    // loopback samples and are not production LCP/ready acceptance.
    await request.get(`/api/bet/${fixture.seasonId}`);
    await request.get(`/${fixture.slug}/bet`);
    const report=[];
    for(const viewer of ["anonymous","unjoined","joined"]){
      if(viewer==="joined"){
        await page.goto(`/${fixture.slug}/bet`);
        await page.getByRole("button",{name:"领取 1,000 积分",exact:true}).click();
        await expect(page.getByRole("button",{name:"领取 1,000 积分",exact:true})).toHaveCount(0);
      }
      const reader=viewer==="anonymous"?request:page.request;
      for(const view of ["open","mine","settled","event","leaderboard","records"]){
        let baseline:unknown;
        for(const state of ["cold","warm","invalidated"]){
          if(state!=="warm"){await operate("暂停投入");await operate("恢复投入");}
          const start=performance.now();
          const response=await reader.get(`/api/bet/${fixture.seasonId}?view=${view}`);
          const body=await response.body();
          const apiMs=performance.now()-start;
          expect(response.status()).toBe(200);
          expect(response.headers()["cache-control"]).toBe("private, no-store");
          const value=JSON.parse(body.toString()).data;
          expect(value.bet.joined).toBe(viewer==="joined");
          expect(value.bet.balance).toBe(viewer==="joined"?"1000":"0");
          expect(value.bet.markets.every((m:{mine:unknown;canStake:boolean})=>m.mine===null && (viewer==="joined" || !m.canStake))).toBe(true);
          expect(value.free.matches.every((m:{result:{mine:unknown};bp:{mine:unknown}})=>m.result.mine===null && m.bp.mine===null)).toBe(true);
          if(state==="cold")baseline=value;else expect(value).toEqual(baseline);
          const rscStart=performance.now();
          const rsc=await reader.get(`/${fixture.slug}/bet?view=${view}`,{headers:{RSC:"1"}});
          const rscBody=await rsc.body();
          expect(rsc.status()).toBe(200);
          expect(rsc.headers()["content-type"]).toContain("text/x-component");
          report.push({view,viewer,state,apiMs,apiBytes:body.length,rscMs:performance.now()-rscStart,rscBytes:rscBody.length,rscCacheState:"after API read"});
        }
      }
    }
    // Actual Pick'Em transport views are sim/record plus tasks/ranking summary;
    // points is rejected and never routes into BET balances or ledgers.
    for(const reader of [request,page.request])for(const view of ["sim","record","tasks","ranking"]){
      const response=await reader.get(`/api/predictions/${fixture.seasonId}?view=${view}`);
      expect(response.status()).toBe(200);
      const body=await response.text();
      for(const key of ["balance","debt","markets","ledger"])expect(body).not.toContain(`"${key}":`);
    }
    expect((await request.get(`/api/predictions/${fixture.seasonId}?view=points`)).status()).toBe(400);
    await info.attach("bet-stage-browser-results",{body:JSON.stringify(report,null,2),contentType:"application/json"});
    console.info("BET_STAGE_BROWSER",JSON.stringify(report));
  }finally{await admin.close();await pool.end();await removePredictionBrowserFixture(fixture.seasonId);}
});
