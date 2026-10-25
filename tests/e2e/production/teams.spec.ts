import { expect, test } from "@playwright/test";

test("队伍目录 production 直达、预取导航和搜索保持可用", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const direct = await page.goto("/teams");
  expect(direct?.status()).toBe(200);
  await expect(page.getByLabel("搜索队伍")).toBeEditable();
  await page.getByLabel("搜索队伍").fill("runtime-boundary-no-match");
  await expect(page).toHaveURL(/q=runtime-boundary-no-match/);
  await expect(page.getByRole("heading", { name: "队伍", exact: true })).toBeVisible();
  await page.goto("/");
  if (testInfo.project.name === "mobile-chrome") await page.getByRole("button", { name: "展开菜单" }).click();
  const link = page.getByRole("link", { name: "队伍", exact: true }).first();
  await expect(link).toBeVisible();
  await link.hover();
  await link.click();
  await expect(page).toHaveURL(/\/teams$/);
  await expect(page.getByLabel("搜索队伍")).toBeEditable();
  await page.getByLabel("队伍状态").selectOption("history");
  await expect(page).toHaveURL(/status=history/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page.getByLabel("队伍状态")).toHaveValue("history");
  expect(errors).toEqual([]);
});
