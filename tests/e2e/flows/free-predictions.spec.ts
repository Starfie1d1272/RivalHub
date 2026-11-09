import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test, expect, signInProgrammatically } from "../fixtures";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import * as schema from "@/db/schema";

test.use({ scenarioProfile: "auth", actionTimeout: 15000 });
test.setTimeout(180000);

// Domain/PG tests cover each lock and settlement. This path covers recovery from a stale open dialog.
test("没有 BET 账户也可提交免费预测，旧弹窗收到锁盘后停止提交", async ({ page, scenario }) => {
  const user = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(user.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const db = drizzle(pool, { schema });
  try {
    await page.clock.install();
    const match = await db.query.matches.findFirst({ where: eq(schema.matches.seasonId, fixture.seasonId) });
    const url = `/${fixture.slug}/bet?match=${match!.id}`;
    await signInProgrammatically(page, user, scenario, `/${fixture.slug}/bet`);
    await page.goto(url);
    const free = page.getByRole("region", { name: "免费赛果预测", exact: true });
    const choices = free.locator("button[aria-pressed]");
    const card = page.locator("article").filter({
      has: page.locator(`a[href^="/${fixture.slug}/matches/${match!.id}?"]`),
    });
    async function openFree() {
      await card.getByRole("tab", { name: /赛果/ }).click();
      await card.getByRole("tabpanel", { name: "赛果", exact: true }).locator("[data-prediction-key]").first().click();
    }

    await openFree();
    await expect(choices.first()).toBeEnabled();
    await choices.first().click();
    await free.getByRole("button", { name: "提交预测", exact: true }).click();
    await expect(free).toContainText("已提交");
    expect(await db.query.betAccounts.findFirst({ where: eq(schema.betAccounts.seasonId, fixture.seasonId) })).toBeUndefined();
    await choices.last().click();
    await free.getByRole("button", { name: "更新预测", exact: true }).click();
    await expect(free.getByRole("button", { name: "更新预测", exact: true })).toBeDisabled();
    await page.reload();
    await openFree();
    await expect(choices.last()).toHaveAttribute("aria-pressed", "true");

    // Freeze polling while the open dialog becomes stale. The server uses the real database clock.
    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    await db.update(schema.matches).set({ gameplayStartedAt: new Date() }).where(eq(schema.matches.id, match!.id));
    await choices.first().click();
    await free.getByRole("button", { name: "更新预测", exact: true }).click();
    await expect(free.getByRole("alert")).toBeVisible();
    await expect(free.getByText("已锁定", { exact: true })).toBeVisible();
    await expect(choices.first()).toBeDisabled();
  } finally {
    const predictions = await db.select({ id: schema.freePredictionChoices.id }).from(schema.freePredictionChoices).where(eq(schema.freePredictionChoices.seasonId, fixture.seasonId));
    if (predictions.length) await db.delete(schema.freePredictionRequests).where(inArray(schema.freePredictionRequests.choiceId, predictions.map(row => row.id)));
    await db.delete(schema.freePredictionChoices).where(eq(schema.freePredictionChoices.seasonId, fixture.seasonId));
    await db.delete(schema.freePredictionLocks).where(eq(schema.freePredictionLocks.seasonId, fixture.seasonId));
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.end();
  }
});
