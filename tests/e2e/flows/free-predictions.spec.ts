import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test, expect, signInProgrammatically } from "../fixtures";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import * as schema from "@/db/schema";

test.use({ scenarioProfile: "auth" });
test.setTimeout(180000);

// Domain/PG tests own scoring, serialization and pool conservation. This browser
// owns independent free/BET action wiring, stale locks and zero-wallet access.
test("免费预测独立于BET，零余额可改选，BP与赛果消费各自官方锁定", async ({ page, scenario }) => {
  const user = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(user.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const db = drizzle(pool, { schema });
  try {
    await page.clock.install();
    const match = await db.query.matches.findFirst({ where: eq(schema.matches.seasonId, fixture.seasonId) });
    const url = `/${fixture.slug}/bet?match=${match!.id}`;
    await signInProgrammatically(page, user, scenario, `/${fixture.slug}/bet`);
    await page.goto(`/${fixture.slug}/matches/${match!.id}`);
    const support = page.getByRole("group", { name: "比赛支持率", exact: true });
    await expect(support).toContainText("暂无预测");
    await expect(support).toContainText("暂无投入");
    await expect(support).not.toContainText("50.0%");
    await page.goto(url);
    const free = page.getByRole("region", { name: "免费赛果预测", exact: true });
    const bp = page.getByRole("region", { name: "免费 BP 预测", exact: true });
    const choices = free.locator("button[aria-pressed]");
    await expect(choices.first()).toBeEnabled();
    await choices.first().click();
    await free.getByRole("button", { name: "提交预测", exact: true }).click();
    await expect(free).toContainText("已提交");
    expect(await db.query.betAccounts.findFirst({ where: eq(schema.betAccounts.seasonId, fixture.seasonId) })).toBeUndefined();
    await choices.last().click(); await free.getByRole("button", { name: "取消改选", exact: true }).click();
    await expect(choices.first()).toHaveAttribute("aria-pressed", "true");
    await bp.locator("button[aria-pressed]").first().click();
    await bp.getByRole("button", { name: "提交预测", exact: true }).click();
    await expect(bp).toContainText("已提交");
    await page.reload(); await expect(choices.first()).toHaveAttribute("aria-pressed", "true");

    execFileSync(resolve("node_modules/.bin/tsx"), ["scripts/db/run-server-cli.ts", "scripts/db/bet-browser-fixture.ts", fixture.seasonId, user.userId], { env: process.env, timeout: 60000 });
    await page.reload();
    await page.getByRole("button", { name: "领取 1,000 积分", exact: true }).click();
    await expect(page.getByRole("button", { name: "领取 1,000 积分", exact: true })).toHaveCount(0);
    const bet = page.getByRole("region", { name: "比赛胜者", exact: true });
    await bet.locator("button:not([aria-label])").last().click();
    await page.getByRole("button", { name: "ALL IN", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认投入", exact: true })).toBeDisabled();
    await page.getByLabel("确认投入全部可用积分，不能撤回").check();
    await page.getByRole("button", { name: "确认投入", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(bet).toContainText("已投 1,000");
    await expect(choices.first()).toHaveAttribute("aria-pressed", "true");
    await expect(choices.last()).toBeEnabled();
    await choices.last().click(); await free.getByRole("button", { name: "更新预测", exact: true }).click();
    await expect(free.getByRole("button", { name: "更新预测", exact: true })).toBeDisabled();
    await expect(choices.last()).toHaveAttribute("aria-pressed", "true");
    await choices.first().click(); await free.getByRole("button", { name: "更新预测", exact: true }).click();
    await expect(free.getByRole("button", { name: "更新预测", exact: true })).toBeDisabled();
    await expect(choices.first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: /^总回合/ })).toBeVisible();

    if (process.env.RIVALHUB_BET_SCREENSHOTS === "1") for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `.agent-tmp/911/real-actions-${width}.png`, fullPage: true, style: "nextjs-portal, [data-sonner-toaster] {visibility:hidden;}" });
    }
    {
      const before = await db.select().from(schema.betLedger).where(eq(schema.betLedger.seasonId, fixture.seasonId));
      expect(before.filter(row => row.kind === "relief")).toHaveLength(0);
      await page.reload();
      const claim = page.getByRole("button", { name: "领取低保 +10", exact: true });
      await expect(claim).toBeEnabled();
      expect((await db.select().from(schema.betLedger).where(eq(schema.betLedger.seasonId, fixture.seasonId))).filter(row => row.kind === "relief")).toHaveLength(0);
      await claim.click();
      await expect(page.getByText("今日已领低保", { exact: true })).toBeVisible();
      await expect(claim).toHaveCount(0);
      await page.reload();
      await expect(page.getByText("今日已领低保", { exact: true })).toBeVisible();
      const grants = (await db.select().from(schema.betLedger).where(eq(schema.betLedger.seasonId, fixture.seasonId))).filter(row => row.kind === "relief");
      expect(grants).toHaveLength(1); expect(grants[0]!.amount).toBe(BigInt(10)); expect(grants[0]!.profit).toBe(BigInt(0));
    }
    // Freeze browser polling so the stale-view rejection is deterministic;
    // server Actions and the official isolated PG clock remain real.
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    await page.waitForLoadState("networkidle");
    await db.insert(schema.matchVetoSessions).values({ matchId: match!.id, startedAt: new Date() });
    // Submit from the cached open view; the Action must reject and fresh-read lock it.
    await bp.locator("button[aria-pressed]").last().click();
    await bp.getByRole("button", { name: "更新预测", exact: true }).click();
    await expect(bp.getByRole("alert")).toBeVisible();
    await expect(bp.locator("button[aria-pressed]").first()).toBeDisabled();
    await expect(choices.first()).toBeEnabled();
    await db.update(schema.matches).set({ gameplayStartedAt: new Date() }).where(eq(schema.matches.id, match!.id));
    await choices.last().click(); await free.getByRole("button", { name: "更新预测", exact: true }).click();
    await expect(free.getByRole("alert")).toBeVisible();
    await expect(choices.first()).toBeDisabled();
    await page.clock.resume();
    await page.reload(); await expect(choices.first()).toBeDisabled();
    await db.update(schema.matches).set({ status: "finished", scoreA: 1, scoreB: 0 }).where(eq(schema.matches.id, match!.id));
    await page.goto(`/${fixture.slug}/bet?view=settled`);
    await expect(free).toContainText("已命中");
    await page.goto(`/${fixture.slug}/bet?view=leaderboard`);
    const ranking = page.getByRole("region", { name: "竞猜排行榜", exact: true });
    for (const label of ["净收益", "赛果命中次数", "赛果命中率"]) {
      await ranking.getByRole("button", { name: label, exact: true }).click();
      await expect(ranking.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
      for (const column of ["净收益", "命中次数", "命中率"]) await expect(ranking.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
    }
    if (process.env.RIVALHUB_BET_SCREENSHOTS === "1") {
      await page.setViewportSize({ width: 320, height: 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: ".agent-tmp/911/real-ranking-320.png", fullPage: true, style: "nextjs-portal, [data-sonner-toaster] {visibility:hidden;}" });
    }
    await db.update(schema.matches).set({ status: "cancelled" }).where(eq(schema.matches.id, match!.id));
    await page.goto(`/${fixture.slug}/bet?view=settled`);
    await expect(free).toContainText("已作废");
    await expect(free).toContainText("比赛已取消");
    await expect(choices.first()).toBeDisabled();
    await page.goto(`/${fixture.slug}/bet?view=mine`);
    await expect(free).toContainText("已作废");
  } finally {
    const predictions = await db.select({ id: schema.freePredictionChoices.id }).from(schema.freePredictionChoices).where(eq(schema.freePredictionChoices.seasonId, fixture.seasonId));
    if (predictions.length) await db.delete(schema.freePredictionRequests).where(inArray(schema.freePredictionRequests.choiceId, predictions.map(row => row.id)));
    await db.delete(schema.freePredictionChoices).where(eq(schema.freePredictionChoices.seasonId, fixture.seasonId));
    await db.delete(schema.freePredictionLocks).where(eq(schema.freePredictionLocks.seasonId, fixture.seasonId));
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.end();
  }
});
