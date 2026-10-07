import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq } from "drizzle-orm";
import { test,expect,signInProgrammatically } from "../fixtures";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { createPredictionBrowserFixture,removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import * as schema from "@/db/schema";
test.use({scenarioProfile:"auth"});test.setTimeout(120000);
test("BET 完成投入、追加、ALL IN 确认与锁盘，桌面和手机无横向溢出",async({page,scenario})=>{
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
    await page.getByRole("button",{name:"启用 BET",exact:true}).last().click();
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
    // section has an accessible label and corresponding implicit region role.
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
    await db.update(schema.matches).set({gameplayStartedAt:new Date()}).where(eq(schema.matches.id,matches[0]!.id));
    await page.reload();await expect(winner.locator("button:not([aria-label])").first()).toBeDisabled();await expect(winner).toContainText("已锁盘");
  }finally {await removePredictionBrowserFixture(fixture.seasonId);await pool.end();}
});
