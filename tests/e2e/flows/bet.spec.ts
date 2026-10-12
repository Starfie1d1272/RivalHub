import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq } from "drizzle-orm";
import { test,expect,signInProgrammatically } from "../fixtures";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { createPredictionBrowserFixture,removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import * as schema from "@/db/schema";
test.use({scenarioProfile:"auth"});test.setTimeout(120000);
test("BET 投入在刷新后保留，ALL IN 需确认且开赛后锁盘",async({page,scenario})=>{
  const user=scenario.accounts[0]!;
  const fixture=await createPredictionBrowserFixture(user.userId);
  const pool=new Pool({connectionString:assertLocalDatabaseUrl(process.env.DATABASE_URL),ssl:false});const db=drizzle(pool,{schema});
  try {
    const matches=await db.select().from(schema.matches).where(eq(schema.matches.seasonId,fixture.seasonId)).then(rows => rows.map(requireCompetitionMatch));
    await db.update(schema.matches).set({format:"bo3"}).where(eq(schema.matches.id,matches[0]!.id));
    await db.insert(schema.seasonAdminGrants).values({seasonId:fixture.seasonId,userId:user.userId});
    await signInProgrammatically(page,user,scenario,`/admin/${fixture.slug}/bet`);
    await page.goto(`/admin/${fixture.slug}/bet`);
    await page.getByRole("button",{name:"启用 BET",exact:true}).click();
    await expect(page.getByRole("region",{name:"BET 操作确认",exact:true})).toBeVisible();
    await page.getByRole("region",{name:"BET 操作确认",exact:true}).getByRole("button",{name:"启用 BET",exact:true}).click();
    await expect(page.getByRole("region",{name:"BET 操作确认",exact:true})).toHaveCount(0);
    await expect(page.getByRole("button",{name:"暂停投入",exact:true})).toBeVisible();
    // Keep the administrator grant: administrators may participate in unrelated markets.
    const allMarkets=await db.select().from(schema.betMarkets).where(eq(schema.betMarkets.matchId,matches[0]!.id));
    const market=allMarkets.find(m=>m.type==="match_winner")!;
    const options=await db.select().from(schema.betOptions).where(eq(schema.betOptions.marketId,market.id)).orderBy(asc(schema.betOptions.position));
    await page.goto(`/${fixture.slug}/bet?match=${matches[0]!.id}`);
    await expect(page.getByRole("heading",{name:"BET",exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:"竞猜平台",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"领取 1,000 积分"}).click();await expect(page.getByRole("button",{name:"领取 1,000 积分"})).toHaveCount(0);
    const card=page.locator("article").filter({has:page.locator(`a[href="/${fixture.slug}/matches/${matches[0]!.id}"]`)});const winner=card.getByRole("region",{name:"比赛胜者"});
    // Real publisher → public DTO → selection/confirmation: seven choices share
    // one pool, and the three-winner market must never show a single-winner estimate.
    expect(allMarkets.filter(m=>m.type.startsWith("veto_")).map(m=>m.type)).toEqual(["veto_present"]);
    await card.getByRole("tab",{name:/地图/}).click();
    const presence=card.getByRole("region",{name:"BP · 本场三图",exact:true});
    await expect(presence.locator("button:not([aria-label])")).toHaveCount(7);
    await presence.locator("button:not([aria-label])").first().click();
    await page.getByLabel("投入积分",{exact:true}).fill("10");
    await expect(page.getByRole("dialog")).not.toContainText("≈");
    await page.getByRole("dialog").getByRole("button",{name:"预计返还说明",exact:true}).focus();
    await expect(page.getByRole("tooltip")).toContainText("三张有效地图共同中奖");
    await page.getByRole("button",{name:"确认投入",exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(presence).toContainText("已投 10");
    await page.reload();await card.getByRole("tab",{name:/地图/}).click();await expect(presence).toContainText("已投 10");
    // section has an accessible label and corresponding implicit region role.
    await card.getByRole("tab",{name:/赛果/}).click();
    await winner.locator("button:not([aria-label])").first().click();
    await expect(page.getByRole("dialog").getByRole("link", { name: `查看 ${options[0]!.label} 资料` })).toHaveAttribute("href", `/${fixture.slug}/teams/${options[0]!.key}`);
    await page.getByLabel("投入积分",{exact:true}).fill("200");
    await page.getByRole("button",{name:"确认投入",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(winner).toContainText("已投 200");await expect(winner.locator("button:not([aria-label])").nth(1)).toBeDisabled();
    await winner.locator("button:not([aria-label])").first().click();await page.getByRole("button",{name:"ALL IN",exact:true}).click();await expect(page.getByRole("button",{name:"确认投入",exact:true})).toBeDisabled();
    await page.getByLabel("确认投入全部可用积分，不能撤回").check();await expect(page.getByRole("button",{name:"确认投入",exact:true})).toBeEnabled();
    await page.getByRole("button",{name:"取消",exact:true}).click();
    await page.reload();
    await expect(winner).toContainText("已投 200");
    // Browser evidence protects the public slot DTO → existing selection/confirmation path.
    // Pool identity, terms, refund and locking matrices belong to PostgreSQL/domain tests.
    await card.getByRole("tab",{name:/地图/}).click();
    await expect(card.getByRole("tabpanel", {name:"地图", exact:true})).toBeVisible();
    const rounds=card.getByRole("region",{name:/^总回合/});
    await expect(rounds).toHaveCount(3);
    const first=rounds.filter({hasText:"第1图 · 地图待定"});
    await first.getByRole("button",{name:/^大/}).click();
    await expect(page.getByRole("dialog")).toContainText("第1图 · 地图待定");
    await page.getByLabel("投入积分",{exact:true}).fill("100");
    await page.getByRole("button",{name:"确认投入",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(first).toContainText("已投 100");
    await page.reload();await card.getByRole("tab",{name:/地图/}).click();await expect(card.getByRole("tabpanel", {name:"地图", exact:true})).toBeVisible();
    await expect(first).toContainText("已投 100");
    if(process.env.RIVALHUB_BET_SCREENSHOTS==="1") {
      for(const [name,width,height] of [["desktop",1440,1000],["mobile",390,900],["narrow",320,900]] as const) {
        await page.setViewportSize({width,height});
        await page.evaluate(()=>window.scrollTo(0,0));
        await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
        await page.screenshot({path:`.agent-tmp/bet-evidence/${name}-prematch.png`,fullPage:true,scale:"css",style:"nextjs-portal { visibility:hidden; }"});
      }
    }
    const maps=await db.insert(schema.matchMaps).values(["de_inferno","de_nuke","de_mirage"].map((mapName,i)=>({matchId:matches[0]!.id,mapOrder:i+1,mapName}))).returning();
    await page.reload();await card.getByRole("tab",{name:/地图/}).click();await expect(card.getByRole("tabpanel", {name:"地图", exact:true})).toBeVisible();
    await expect(rounds.filter({hasText:"第1图 · Inferno"})).toContainText("已投 100");
    await db.update(schema.matchMaps).set({startedAt:new Date()}).where(eq(schema.matchMaps.id,maps[0]!.id));
    await page.reload();await card.getByRole("tab",{name:/地图/}).click();await expect(card.getByRole("tabpanel", {name:"地图", exact:true})).toBeVisible();
    await expect(presence.locator("button:not([aria-label])").first()).toBeDisabled();
    await expect(rounds.filter({hasText:"第1图 · Inferno"}).getByRole("button",{name:/^大/})).toBeDisabled();
    await expect(rounds.filter({hasText:"第2图 · Nuke"}).getByRole("button",{name:/^大/})).toBeEnabled();
    await db.update(schema.matches).set({gameplayStartedAt:new Date()}).where(eq(schema.matches.id,matches[0]!.id));
    await page.reload();await expect(card.getByRole("tabpanel", {name:"赛果", exact:true})).toBeVisible();await expect(winner.locator("button:not([aria-label])").first()).toBeDisabled();await expect(winner).toContainText("已锁盘");
  }finally {await removePredictionBrowserFixture(fixture.seasonId);await pool.end();}
});
