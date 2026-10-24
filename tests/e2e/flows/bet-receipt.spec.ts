import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {Pool} from "pg";
import {drizzle} from "drizzle-orm/node-postgres";
import {eq} from "drizzle-orm";
import {test,expect,signInProgrammatically} from "../fixtures";
import {createPredictionBrowserFixture,removePredictionBrowserFixture} from "../helpers/prediction-fixture";
import {assertLocalDatabaseUrl} from "../../../scripts/db/local-environment";
import * as schema from "@/db/schema";
test.use({scenarioProfile:"auth",actionTimeout:15000});
test.setTimeout(120000);
// Complements the admin-to-stake journey: a deterministic public transport fault
// must prove receipt confirmation itself never sends a second financial command.
test("断流投入只读核对原回执，刷新等待不阻塞确认，撤回后私有 GET 拒绝读取",async({page,request,scenario})=>{
  const user=scenario.accounts[0]!;
  const fixture=await createPredictionBrowserFixture(user.userId);
  const pool=new Pool({connectionString:assertLocalDatabaseUrl(process.env.DATABASE_URL),ssl:false});
  const db=drizzle(pool,{schema});
  try{
    execFileSync(resolve("node_modules/.bin/tsx"),["scripts/db/run-server-cli.ts","scripts/db/bet-browser-fixture.ts",fixture.seasonId,user.userId],{env:process.env,timeout:60000});
    const market=(await db.select().from(schema.betMarkets).where(eq(schema.betMarkets.seasonId,fixture.seasonId))).find(market=>market.type==="match_winner")!;
    const [option]=await db.select().from(schema.betOptions).where(eq(schema.betOptions.marketId,market.id));
    await signInProgrammatically(page,user,scenario,`/${fixture.slug}/bet`);
    await page.goto(`/${fixture.slug}/bet?match=${market.matchId}`);
    await page.getByRole("button",{name:"领取 1,000 积分",exact:true}).click();
    await expect(page.getByRole("button",{name:"领取 1,000 积分",exact:true})).toHaveCount(0);
    const anonymous=await request.get(`/api/bet/${fixture.seasonId}?matchId=${market.matchId}`);
    expect(anonymous.headers()["cache-control"]).toBe("private, no-store");
    expect((await anonymous.json()).data.bet).toMatchObject({joined:false,balance:"0",records:[]});
    await page.locator(`button[data-bet-option="${option!.id}"]`).click();
    await page.getByLabel("投入积分",{exact:true}).fill("25");
    let dropped=false;
    const dropCommitted:Parameters<typeof page.route>[1]=async route=>{
      if(!dropped&&route.request().method()==="POST"&&route.request().headers()["next-action"]){dropped=true;await route.fetch();await route.abort("failed");}else await route.continue();
    };
    await page.route("**/*",dropCommitted);
    await page.getByRole("button",{name:"确认投入",exact:true}).click();
    await expect(page.getByRole("button",{name:"核对投入结果",exact:true})).toBeVisible();
    await page.unroute("**/*",dropCommitted);
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    let handled:Promise<void>|undefined;
    const delay:Parameters<typeof page.route>[1]=route=>{handled=(async()=>{await gate;await route.continue();})();return handled;};
    await page.route("**/api/bet/*",delay);
    try{
      await page.getByRole("button",{name:"核对投入结果",exact:true}).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect.poll(()=>!!handled).toBe(true);
    }finally{release();await handled;await page.unroute("**/api/bet/*",delay);}
    const stakes=await db.select().from(schema.betStakes).where(eq(schema.betStakes.marketId,market.id));
    expect(stakes.map(stake=>stake.amount.toString())).toEqual(["25"]);
    const fresh=await page.request.get(`/api/bet/${fixture.seasonId}?matchId=${market.matchId}`);
    expect((await fresh.json()).data.bet.balance).toBe("975");
    const repositoryLink=page.getByRole("contentinfo").getByRole("link",{name:/GITHUB/});
    await repositoryLink.scrollIntoViewIfNeeded();await expect(repositoryLink).toBeVisible();
    await db.update(schema.seasons).set({status:"draft"}).where(eq(schema.seasons.id,fixture.seasonId));
    expect((await request.get(`/api/bet/${fixture.seasonId}`)).status()).toBe(404);
    expect((await page.request.get(`/api/bet/${fixture.seasonId}`)).status()).toBe(404);
  }finally{await removePredictionBrowserFixture(fixture.seasonId);await pool.end();}
});
