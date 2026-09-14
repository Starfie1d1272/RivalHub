import { expect } from "@playwright/test";
import { signInProgrammatically, test } from "../fixtures";

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

test.describe("目标页面在 390px mobile 与 1440px desktop 遵守宽度语义", () => {
  test.use({ scenarioProfile: "layout" });

  test("保留 launcher safe area 并让目标页面使用正确的 width owner", async ({ page, scenario }, testInfo) => {
    const mobile = testInfo.project.name === "mobile-chrome";
    test.skip(!mobile && testInfo.project.name !== "chromium", "该回归只在 desktop Chrome 与 390px mobile Chrome 执行。");

    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    const assertNoDocumentOverflow = async () => {
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    };

    await page.goto("/rules");
    await expect(page.locator("footer")).toBeVisible();
    await expect(page.locator("footer")).toHaveCSS("padding-right", mobile ? "28px" : "80px");
    await assertNoDocumentOverflow();

    const player = scenario.accounts.find((account) => account.key === "player2");
    const admin = scenario.accounts.find((account) => account.key === "admin");
    if (!player || !admin) throw new Error(`layout scenario ${scenario.scenarioId} 缺少 player2 或 admin。`);

    await page.goto("/" + scenario.slug + "/community-awards");
    await expect(page.locator('[data-layout-variant="wide"]')).toBeVisible();
    await assertNoDocumentOverflow();

    await page.goto("/players/" + player.userId);
    await expect(page.locator('[data-layout-variant="standard"]:not([aria-busy="true"])')).toBeVisible();
    await assertNoDocumentOverflow();

    await signInProgrammatically(page, admin, scenario, "/admin/invites");
    await expect(page.locator('[data-layout-variant="wide"]')).toBeVisible();
    await assertNoDocumentOverflow();

    await page.goto("/admin/" + scenario.slug + "/community-awards");
    await expect(page.locator('[data-layout-variant="workbench"]')).toBeVisible();
    await assertNoDocumentOverflow();
  });
});
