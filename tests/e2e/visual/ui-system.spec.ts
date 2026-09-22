import { expect, signInProgrammatically, test } from "../fixtures";

test.use({ scenarioProfile: "auth" });

const SCREENSHOT_OPTIONS = {
  animations: "disabled" as const,
  caret: "hide" as const,
  scale: "css" as const,
  maxDiffPixelRatio: 0.02,
};

test.describe("UI system visual regression", () => {
  test("privacy narrow reference · 390 × 844", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "390px baseline 使用现有 Pixel 5 project。");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "隐私与数据使用说明" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("privacy-390x844.png", SCREENSHOT_OPTIONS);
  });

  test("privacy narrow reference · 1440 × 900", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "1440px baseline 使用现有 Desktop Chrome project。");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "隐私与数据使用说明" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("privacy-1440x900.png", SCREENSHOT_OPTIONS);
  });

  test("authenticated foundation reference · 768 × 844", async ({ page, scenario }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "768px authenticated baseline 使用 Desktop Chrome project。");
    const referenceAccount = scenario.accounts.find((account) => account.key === "player3");
    if (!referenceAccount) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少稳定只读账号。`);

    await page.setViewportSize({ width: 768, height: 844 });
    await signInProgrammatically(page, referenceAccount, scenario, "/my");
    await expect(page.getByRole("heading", { name: "我的参赛" })).toBeVisible();
    await expect(page.locator("main")).toHaveScreenshot("my-readiness-768x844.png", SCREENSHOT_OPTIONS);
  });
});
