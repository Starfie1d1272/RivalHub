import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { test,expect,signInProgrammatically } from "../fixtures";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { createPredictionBrowserFixture,removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import * as schema from "@/db/schema";
test.use({scenarioProfile:"auth"});test.setTimeout(120000);
test("BET 投入在刷新后保留，ALL IN 需确认",async({page,scenario,request})=>{
  const user=scenario.accounts[0]!;
  const fixture=await createPredictionBrowserFixture(user.userId);
  const pool=new Pool({connectionString:assertLocalDatabaseUrl(process.env.DATABASE_URL),ssl:false});const db=drizzle(pool,{schema});
  try {
    const matches=await db.select().from(schema.matches).where(eq(schema.matches.seasonId,fixture.seasonId)).then(rows => rows.map(requireCompetitionMatch));
    await db.insert(schema.seasonAdminGrants).values({seasonId:fixture.seasonId,userId:user.userId});
    await signInProgrammatically(page,user,scenario,`/admin/${fixture.slug}/bet`);
    await page.getByRole("button",{name:"启用 BET",exact:true}).click();
    await expect(page.getByRole("region",{name:"BET 操作确认",exact:true})).toBeVisible();
    await page.getByRole("region",{name:"BET 操作确认",exact:true}).getByRole("button",{name:"启用 BET",exact:true}).click();
    await expect(page.getByRole("region",{name:"BET 操作确认",exact:true})).toHaveCount(0);
    await expect(page.getByRole("button",{name:"暂停投入",exact:true})).toBeVisible();
    // Keep the administrator grant: administrators may participate in unrelated markets.
    const allMarkets=await db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,matches[0]!.id));
    const market=allMarkets.find(m=>m.type==="match_winner")!;
    await page.goto(`/${fixture.slug}/bet?match=${matches[0]!.id}`,{waitUntil:"domcontentloaded"});
    await expect(page.getByRole("heading",{name:"预测与竞猜",exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:"预测与竞猜",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"领取 1,000 积分"}).click();await expect(page.getByRole("button",{name:"领取 1,000 积分"})).toHaveCount(0);
    const publicRead=await request.get(`/api/bet/${fixture.seasonId}?matchId=${matches[0]!.id}`);
    expect(publicRead.headers()["cache-control"]).toBe("private, no-store");
    expect((await publicRead.json()).data.bet).toMatchObject({joined:false,balance:"0",records:[]});
    expect((await page.request.get(`/api/bet/${fixture.seasonId}?matchId=${matches[0]!.id}`)).ok()).toBe(true);
    const card=page.locator("article").filter({has:page.locator(`a[href^="/${fixture.slug}/matches/${matches[0]!.id}?"]`)});const winner=card.getByRole("region",{name:"比赛胜者"});
    await winner.locator("button[data-bet-option]").first().click();
    await page.getByLabel("投入积分",{exact:true}).fill("200");
    await page.getByRole("button",{name:"确认投入",exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const confirmedStakes=await db.select().from(schema.betStakes).where(eq(schema.betStakes.marketId,market.id));
    expect(confirmedStakes.map(stake=>stake.amount.toString())).toEqual(["200"]);
    await expect(winner).toContainText("已投 200");
    await winner.locator("button[data-bet-option]").first().click();
    await page.getByRole("button",{name:"ALL IN",exact:true}).click();
    await expect(page.getByRole("button",{name:"确认投入",exact:true})).toBeDisabled();
    await page.getByLabel("确认投入全部可用积分，不能撤回").check();
    await expect(page.getByRole("button",{name:"确认投入",exact:true})).toBeEnabled();
    await page.getByRole("button",{name:"取消",exact:true}).click();
    await page.reload();
    await expect(winner).toContainText("已投 200");

    await db.update(schema.seasons).set({status:"draft"}).where(eq(schema.seasons.id,fixture.seasonId));
    expect((await request.get(`/api/bet/${fixture.seasonId}`)).status()).toBe(404);
    expect((await page.request.get(`/api/bet/${fixture.seasonId}`)).status()).toBe(200);
  }finally {await removePredictionBrowserFixture(fixture.seasonId);await pool.end();}
});
