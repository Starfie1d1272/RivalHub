import type { BrowserContext } from "@playwright/test";
import { expect, signInProgrammatically, test } from "../fixtures";

test.use({ scenarioProfile: "education" });
const evidencePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2foAAAAASUVORK5CYII=", "base64");

test("新生可以提交录取通知书并由 super admin 查看后审核", async ({ browser, page, scenario }) => {
  const player = scenario.accounts.find((account) => account.key === "player1");
  const admin = scenario.accounts.find((account) => account.key === "admin");
  if (!player || !admin) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少教育流程账号。`);
  const playerSearch = encodeURIComponent(player.email);
  const playerLabel = player.email.split("@")[0];
  const stage = (name: string, work: () => Promise<void>) => test.step(name, work);
  let adminContext: BrowserContext | undefined;
  let operationFailed = false;
  try {
    await stage("新生登录并打开教育认证", async () => {
      await signInProgrammatically(page, player, scenario, "/settings/education");
      const manualToggle = page.locator('button[aria-controls="education-manual-fallback"]');
      await expect.poll(async () => {
        if (await manualToggle.getAttribute("aria-expanded") !== "true") await manualToggle.click();
        return (await manualToggle.getAttribute("aria-expanded")) === "true";
      }).toBe(true);
      await expect(page.getByRole("heading", { name: "录取通知书人工审核" })).toBeVisible();
    });

    await stage("提交录取通知书证据", async () => {
      await page.locator("#manual-institution-search").fill("南京大学");
      await page.getByRole("button", { name: "搜索高校" }).last().click();
      await page.getByRole("button", { name: /南京大学/ }).last().click();
      await page.locator("#admission-notice-file").setInputFiles({
        name: "original-private-name.pdf",
        mimeType: "image/png",
        buffer: evidencePng,
      });
      await page.getByRole("button", { name: "提交录取通知书" }).click();
      await expect(page.getByText("教育认证已提交，等待管理员审核。", { exact: true })).toBeVisible();
    });

    adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await stage("超管登录并读取待审核申请", async () => {
      await signInProgrammatically(adminPage, admin, scenario, "/admin/education-verifications");
      await adminPage.goto(`/admin/education-verifications?status=all&q=${playerSearch}`);
      await expect(adminPage.getByText("材料：录取通知书材料", { exact: true })).toBeVisible();
    });

    await stage("超管查看私有录取证据", async () => {
      const viewEvidence = adminPage.getByRole("link", { name: "查看材料" }).last();
      await expect(viewEvidence).toBeVisible();
      await expect(viewEvidence).toHaveAttribute("target", "_blank");
      await expect(viewEvidence).toHaveAttribute("rel", "noopener noreferrer");
      const [evidencePage] = await Promise.all([
        adminContext!.waitForEvent("page"),
        viewEvidence.click(),
      ]);
      await evidencePage.waitForURL(/\/storage\/v1\/object\/sign\/education-evidence\//, { waitUntil: "domcontentloaded" });
      await expect(evidencePage.locator("img")).toHaveJSProperty("naturalWidth", 1);
      await expect(evidencePage.locator("img")).toHaveJSProperty("naturalHeight", 1);
      await evidencePage.close();
    });

    await stage("超管审核通过", async () => {
      const approve = adminPage.getByRole("button", { name: "通过" }).last();
      await expect(approve).toBeVisible();
      adminPage.on("dialog", (dialog) => dialog.accept(""));
      await approve.click();
      await expect(adminPage.getByText("认证已通过", { exact: true })).toBeVisible();
    });
    await stage("核对最终审核结果", async () => {
      await expect(adminPage.getByText(`${playerLabel} · 已通过`, { exact: true })).toBeVisible();
    });
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try { await adminContext?.close(); }
    catch (error) { if (!operationFailed) throw error; }
  }
});
