import { expect, test } from "../fixtures";

test.use({ scenarioProfile: "major-entry" });

test("公开赛事队伍与选手查询保留 URL 状态及移动布局", async ({ page, scenario }) => {
  await page.goto(`/${scenario.slug}/teams`);
  await expect(page.getByLabel("搜索队伍或选手")).toBeVisible();
  await page.getByLabel("搜索队伍或选手").fill("unmatched-public-query");
  await expect(page).toHaveURL(/q=unmatched-public-query/);
  await expect(page.getByText("没有匹配的队伍或选手")).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("搜索队伍或选手")).toHaveValue("");

  await page.goto(`/${scenario.slug}/players`);
  await expect(page.getByRole("heading", { name: "选手", exact: true })).toBeVisible();
  await expect(page.getByLabel("所属队伍")).toBeVisible();
  await page.getByLabel("搜索选手").fill("unmatched-player");
  await expect(page).toHaveURL(/q=unmatched-player/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  await page.goto(`/${scenario.slug}/community-awards`);
  await expect(page.getByRole("button", { name: "提交社区奖", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "登录后提出社区奖" })).toBeVisible();
});
