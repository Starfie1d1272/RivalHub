import { test, expect } from "@playwright/test";

// Phase 1 E2E smoke test for the public home page.
test("首页返回 200 并包含 RivalHub 品牌", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/RivalHub/);
  await expect(page.getByRole("link", { name: "RIVALHUB" })).toBeVisible();
});
