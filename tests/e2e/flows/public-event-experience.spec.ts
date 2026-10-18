import { expect, test } from "../fixtures";

test.use({ scenarioProfile: "major-entry" });

test("参赛阵容查询保留 URL 状态，Major 旧选手地址转到阵容", async ({ page, scenario }) => {
  await page.goto(`/${scenario.slug}/teams`);
  await expect(page.getByRole("heading", { name: "参赛阵容", exact: true })).toBeVisible();
  await expect(page.getByLabel("搜索队伍或选手")).toBeVisible();
  const teamSearch = page.getByLabel("搜索队伍或选手");
  await teamSearch.fill("unmatched-public-query");
  await expect(page).toHaveURL(/q=unmatched-public-query/);
  await expect(teamSearch).toHaveValue("unmatched-public-query");
  await expect(page.getByText("没有匹配的队伍或选手")).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("搜索队伍或选手")).toHaveValue("");

  await page.goto(`/${scenario.slug}/players?q=unmatched-player`);
  await expect(page).toHaveURL(new RegExp(`/${scenario.slug}/teams\\?q=unmatched-player$`));
  await expect(page.getByRole("heading", { name: "参赛阵容", exact: true })).toBeVisible();
  await expect(page.getByLabel("搜索队伍或选手")).toHaveValue("unmatched-player");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
