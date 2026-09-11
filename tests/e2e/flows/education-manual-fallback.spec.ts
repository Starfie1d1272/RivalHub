import { expect, signInProgrammatically, test } from "../fixtures";

test.use({ scenarioProfile: "education" });

test.skip(({ viewport }) => (viewport?.width ?? 0) < 800, "有状态的教育认证流程只在桌面项目执行一次，避免并发 project 竞争共享 fixture。");

test("新生可以提交录取通知书并由 super admin 查看后审核", async ({ browser, page, scenario }) => {
  const player = scenario.accounts.find((account) => account.key === "player1");
  const admin = scenario.accounts.find((account) => account.key === "admin");
  if (!player || !admin) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少教育流程账号。`);
  const playerSearch = encodeURIComponent(player.email);
  const playerLabel = player.email.split("@")[0];

  await signInProgrammatically(page, player, scenario, "/settings/education");
  const manualToggle = page.locator('button[aria-controls="education-manual-fallback"]');
  await expect.poll(async () => {
    if (await manualToggle.getAttribute("aria-expanded") !== "true") await manualToggle.click();
    return (await manualToggle.getAttribute("aria-expanded")) === "true";
  }).toBe(true);
  await expect(page.getByRole("heading", { name: "录取通知书人工审核" })).toBeVisible();

  await page.locator("#manual-institution-search").fill("南京大学");
  await page.getByRole("button", { name: "搜索高校" }).last().click();
  await page.getByRole("button", { name: /南京大学/ }).last().click();
  await page.locator("#admission-notice-file").setInputFiles({
    name: "original-private-name.pdf",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  await page.getByRole("button", { name: "提交录取通知书" }).click();
  await expect(page.getByText("教育认证已提交，等待管理员审核。", { exact: true })).toBeVisible();

  const adminContext = await browser.newContext();
  try {
    const adminPage = await adminContext.newPage();
    await signInProgrammatically(adminPage, admin, scenario, "/admin");
    await adminPage.goto(`/admin/education-verifications?status=all&q=${playerSearch}`);
    await expect(adminPage.getByText("材料：录取通知书材料", { exact: true })).toBeVisible();

    const viewEvidence = adminPage.getByRole("link", { name: "查看材料" }).last();
    await expect(viewEvidence).toBeVisible();
    await expect(viewEvidence).toHaveAttribute("target", "_blank");
    await expect(viewEvidence).toHaveAttribute("rel", "noopener noreferrer");
    const [evidencePage] = await Promise.all([
      adminContext.waitForEvent("page"),
      viewEvidence.click(),
    ]);
    await evidencePage.waitForURL(/education-evidence/);
    await evidencePage.close();

    const approve = adminPage.getByRole("button", { name: "通过" }).last();
    await expect(approve).toBeVisible();
    adminPage.on("dialog", (dialog) => dialog.accept(""));
    await approve.click();
    await expect(adminPage.getByText("认证已通过", { exact: true })).toBeVisible();
    await expect(adminPage.getByText(`${playerLabel} · 已通过`, { exact: true })).toBeVisible();
  } finally {
    await adminContext.close();
  }
});
