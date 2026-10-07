import { expect, test } from "../fixtures";

test.use({ scenarioProfile: "stats" });

test("数据中心统一入口、赛事选择、URL 状态与历史恢复", async ({ page, scenario }) => {
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
  await expect(page.getByRole("heading", { name: "Records" })).toBeVisible();
  await expect(page.getByText("Most Kills in a Map", { exact: true })).toBeVisible();
  await expect(page.getByText("确认完整数据后展示")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(`/stats?event=${scenario.slug}`);
  await expect(tabs.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Records" })).toBeVisible();
  await page.goto(`/${scenario.slug}/stats?tab=players&format=bo3`);
  await expect(page).toHaveURL(`/stats?tab=players&format=bo3&event=${scenario.slug}`);
  await expect(page.getByLabel("赛制")).toHaveValue("bo3");
  await page.getByRole("button", { name: "选择赛事", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "选择赛事", exact: true })).toBeFocused();
});
