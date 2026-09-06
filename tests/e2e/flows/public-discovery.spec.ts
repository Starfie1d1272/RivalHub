import { expect, test } from "@playwright/test";

test("移动端公开发现列表可操作共享筛选工具栏", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "该验收专门覆盖移动端公开发现流程。");

  await page.goto("/teams");
  await expect(page.getByRole("heading", { name: "队伍", exact: true })).toBeVisible();
  await page.getByLabel("搜索队伍").fill("mobile-query");
  await expect(page).toHaveURL(/\/teams\?q=mobile-query$/);

  await page.goto("/teams/recruitment?view=players&map=de_mirage");
  await expect(page.getByRole("heading", { name: "组队大厅", exact: true })).toBeVisible();
  await expect(page.getByLabel("搜索选手")).toBeVisible();
  await expect(page.getByLabel("地图熟练度")).toBeVisible();
  await page.getByRole("tab", { name: /队伍招募/ }).click();
  await expect(page).toHaveURL(/\/teams\/recruitment\?view=teams$/);
  await expect(page.getByLabel("队伍规模")).toBeVisible();

  const hasNoHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(hasNoHorizontalOverflow).toBe(true);
});
