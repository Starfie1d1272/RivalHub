import { expect, test } from "../fixtures";

test.use({ scenarioProfile: "layout" });

test("数据中心统一入口、赛事选择、六视图和旧入口迁移", async ({ page, scenario }, testInfo) => {
  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "数据中心", exact: true })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "数据中心", exact: true });
  await expect(tabs.getByRole("link")).toHaveCount(6);
  await expect(tabs.getByRole("link", { name: "Insights", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "选择赛事", exact: true }).click();
  const search = page.getByRole("textbox", { name: "搜索名称或 slug" });
  await search.fill(scenario.slug);
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page).toHaveURL(/\/stats$/); // Search only filters options.
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/stats?event=${scenario.slug}`);
  await expect(page.getByRole("button", { name: "选择赛事", exact: true })).toContainText(scenario.seasonName);
  await tabs.getByRole("link", { name: "Records", exact: true }).click();
  await expect(page.getByRole("heading", { name: "当前范围纪录" })).toBeVisible();
  await expect(page.getByText("暂无满足所需完整数据的纪录")).toHaveCount(6);
  await page.goBack();
  await expect(page).toHaveURL(`/stats?event=${scenario.slug}`);
  await expect(tabs.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page.getByRole("heading", { name: "当前范围纪录" })).toBeVisible();
  await page.goto(`/${scenario.slug}/stats?tab=players&format=bo3`);
  await expect(page).toHaveURL(`/stats?tab=players&format=bo3&event=${scenario.slug}`);
  await expect(page.getByLabel("赛制")).toHaveValue("bo3");
  await page.getByRole("button", { name: "选择赛事", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "选择赛事", exact: true })).toBeFocused();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`platform-stats-${width}.png`), fullPage: true });
  }
  await page.goto("/stats?event=does-not-exist");
  await expect(page.getByRole("heading", { name: "统计范围不可用" })).toBeVisible();
  await page.goto("/stats?stage=unknown");
  await expect(page.getByRole("heading", { name: "统计范围不可用" })).toBeVisible();
});
