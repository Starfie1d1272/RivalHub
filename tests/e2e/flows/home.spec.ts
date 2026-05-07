import { test, expect } from "@playwright/test";

// hello-world E2E 桩
// TODO: Phase 3+ 后补充完整页面验证

test("首页返回 200 并包含平台名称", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/NJU CS2/);
});
