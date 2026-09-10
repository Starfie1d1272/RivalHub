import { expect, test } from "@playwright/test";

test("长文页面在桌面与 390px mobile 使用统一 page gutter 且不产生 document overflow", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chrome";
  test.skip(!mobile && testInfo.project.name !== "chromium", "该回归只在 desktop Chrome 与 390px mobile Chrome 执行。");

  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "NJU Major 2026 赛事规则 v1.0" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});
