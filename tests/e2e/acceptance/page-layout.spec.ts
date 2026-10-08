import { expect } from "@playwright/test";
import { test } from "../fixtures";

test("长文页面在桌面与 390px mobile 不产生 document overflow", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chrome";

  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "NJU Major 赛事规则 v1.1" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});
