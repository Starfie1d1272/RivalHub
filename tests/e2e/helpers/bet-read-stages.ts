import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { APIRequestContext, BrowserContext, Page, Request, TestInfo } from "@playwright/test";
import { expect,signInProgrammatically,type E2EFixtureCredentials } from "../fixtures";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { redactText } from "../../../src/lib/observability/redact";
import { createPredictionBrowserFixture,removePredictionBrowserFixture } from "./prediction-fixture";
import * as schema from "@/db/schema";

/** Isolated loopback fixtures only. No production bootstrap route or credentials. */
export async function verifyBetReadStages(
  {page,context,scenario,request}:{page:Page;context:BrowserContext;scenario:E2EFixtureCredentials;request:APIRequestContext},
  info:TestInfo, production=false, views?:readonly string[],
){
  const user=scenario.accounts[0]!;
  const fixture=await createPredictionBrowserFixture(user.userId);
  const pool=new Pool({connectionString:assertLocalDatabaseUrl(process.env.DATABASE_URL),ssl:false});
  const db=drizzle(pool,{schema});
  const admin=await context.newPage();
  let phase="setup";
  const pending=new Map<Request,{method:string;path:string;startedAt:number}>();
  const errors:{source:string;message:string}[]=[];
  for(const target of [page,admin]){
    target.setDefaultTimeout(15000);
    target.setDefaultNavigationTimeout(30000);
    target.on("request",r=>pending.set(r,{method:r.method(),path:new URL(r.url()).pathname,startedAt:performance.now()}));
    target.on("requestfinished",r=>pending.delete(r));
    target.on("requestfailed",r=>{pending.delete(r);if(errors.length<30)errors.push({source:"request",message:redactText(`${new URL(r.url()).pathname}: ${r.failure()?.errorText}`,300)});});
    target.on("pageerror",e=>{if(errors.length<30)errors.push({source:"page",message:redactText(e.message,300)});});
    target.on("console",m=>{if(m.type()==="error"&&errors.length<30)errors.push({source:"console",message:redactText(m.text(),300)});});
  }
  try{
    await db.insert(schema.seasonAdminGrants).values({seasonId:fixture.seasonId,userId:user.userId});
    const destination=`/admin/${fixture.slug}/bet`;
    phase="login";
    if(production){
      // The test bootstrap endpoint is deliberately disabled in production.
      // Exercise the existing canonical login UI and local Turnstile test key.
      await page.goto(`/login?next=${encodeURIComponent(destination)}`);
      await page.getByLabel("邮箱地址").fill(user.email);
      await page.getByLabel("密码",{exact:true}).fill(scenario.password);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(url=>url.pathname===destination);
    }else await signInProgrammatically(page,user,scenario,destination);
    await admin.goto(destination,{waitUntil:"domcontentloaded"});
    async function operate(label:string){
      phase=`admin.${label}`;
      const button=admin.getByRole("button",{name:label,exact:true});
      // A streamed shell is not hydration. Fail at this boundary with console,
      // pending request and DB-wait evidence instead of a whole-test timeout.
      await expect(button).toBeEnabled({timeout:20000});
      await button.click();
      const confirmation=admin.getByRole("region",{name:"BET 操作确认",exact:true});
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button",{name:label,exact:true}).click();
      await expect(confirmation).toHaveCount(0);
    }
    await operate("启用 BET");
    await expect(admin.getByRole("button",{name:"暂停投入",exact:true})).toBeEnabled();
    // Compile/initialize these routes before recording transport timings.
    await request.get(`/api/bet/${fixture.seasonId}`);
    await request.get(`/${fixture.slug}/bet`);
    const report=[];
    for(const viewer of production?["anonymous","joined"]:["anonymous","unjoined","joined"]){
      if(viewer==="joined"){
        phase="viewer.join";
        await page.goto(`/${fixture.slug}/bet`);
        await page.getByRole("button",{name:"领取 1,000 积分",exact:true}).click();
        await expect(page.getByRole("button",{name:"领取 1,000 积分",exact:true})).toHaveCount(0);
      }
      const reader=viewer==="anonymous"?request:page.request;
      for(const view of views ?? (production?["open","mine","event"]:["open","mine","settled","event","leaderboard","records"])){
        let baseline:unknown;
        for(const state of ["cold","warm","invalidated"]){
          if(state!=="warm"){await operate("暂停投入");await operate("恢复投入");}
          phase=`${viewer}.${view}.${state}.api`;
          const start=performance.now();
          const response=await reader.get(`/api/bet/${fixture.seasonId}?view=${view}`,{timeout:15000});
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
          phase=`${viewer}.${view}.${state}.rsc`;
          const rscStart=performance.now();
          const rsc=await reader.get(`/${fixture.slug}/bet?view=${view}`,{headers:{RSC:"1"},timeout:15000});
          const rscBody=await rsc.body();
          expect(rsc.status()).toBe(200);
          expect(rsc.headers()["content-type"]).toContain("text/x-component");
          report.push({view,viewer,state,runtime:production?"production":"development",apiMs,apiBytes:body.length,rscMs:performance.now()-rscStart,rscBytes:rscBody.length,rscCacheState:"after API read"});
        }
      }
    }
    // Actual Pick'Em views remain independent of BET financial data.
    for(const reader of [request,page.request])for(const view of ["sim","record","tasks","ranking"]){
      phase=`predictions.${view}`;
      const response=await reader.get(`/api/predictions/${fixture.seasonId}?view=${view}`,{timeout:15000});
      expect(response.status()).toBe(200);
      const body=await response.text();
      for(const key of ["balance","debt","markets","ledger"])expect(body).not.toContain(`"${key}":`);
    }
    expect((await request.get(`/api/predictions/${fixture.seasonId}?view=points`)).status()).toBe(400);
    await info.attach("bet-stage-browser-results",{body:JSON.stringify(report,null,2),contentType:"application/json"});
    console.info("BET_STAGE_BROWSER",JSON.stringify(report));
  }catch(error){
    const waits=await pool.query("select state,wait_event_type,wait_event,count(*)::int as count from pg_stat_activity where datname=current_database() group by state,wait_event_type,wait_event").then(r=>r.rows).catch(()=>"unavailable");
    await info.attach("bet-stage-failure-boundary",{body:JSON.stringify({phase,errors,pending:[...pending.values()].map(r=>({...r,elapsedMs:performance.now()-r.startedAt})),databaseWaits:waits},null,2),contentType:"application/json"});
    throw error;
  }finally{await admin.close();await pool.end();await removePredictionBrowserFixture(fixture.seasonId);}
}
