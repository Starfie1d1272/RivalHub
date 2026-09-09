import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type FixtureCredentials = {
  password: string;
  accounts: Array<{ key: string; email: string; userId: string }>;
};

function loadCredentials(): FixtureCredentials {
  return JSON.parse(readFileSync(resolve(process.cwd(), ".agent-tmp", "major-browser-credentials.json"), "utf8")) as FixtureCredentials;
}

async function signIn(page: Page, email: string, password: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("邮箱地址").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === next, { timeout: 20_000 });
}

test.skip(({ viewport }) => (viewport?.width ?? 0) < 800, "有状态的教育认证流程只在桌面项目执行一次，避免并发 project 竞争共享 fixture。");

test("新生可以提交录取通知书并由 super admin 查看后审核", async ({ browser, page }) => {
  test.setTimeout(60_000);
  const credentials = loadCredentials();
  const player = credentials.accounts.find((account) => account.key === "player1");
  const admin = credentials.accounts.find((account) => account.key === "admin");
  if (!player || !admin) throw new Error("browser fixture 缺少 player1 或 admin 账号。");
  const playerSearch = encodeURIComponent(player.email);

  await signIn(page, player.email, credentials.password, "/settings/education");
  await page.getByRole("button", { name: "暂时无法获取学信网材料？" }).click();
  await expect(page.getByRole("heading", { name: "录取通知书人工审核" })).toBeVisible({ timeout: 20_000 });

  await page.locator("#manual-institution-search").fill("南京大学");
  await page.getByRole("button", { name: "搜索高校" }).last().click();
  await page.getByRole("button", { name: /南京大学/ }).last().click();
  await page.locator("#admission-notice-file").setInputFiles({
    name: "original-private-name.pdf",
    mimeType: "image/png",
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  await page.getByRole("button", { name: "提交录取通知书" }).click();
  await expect(page.getByText(/教育认证已提交，等待管理员审核。|该学校的教育认证正在等待审核，无需重复提交。|该学校的教育身份已完成认证，无需重复提交。/)).toBeVisible({ timeout: 20_000 });

  const adminContext = await browser.newContext();
  try {
    const adminPage = await adminContext.newPage();
    await signIn(adminPage, admin.email, credentials.password, "/admin");
    await adminPage.goto(`/admin/education-verifications?status=all&q=${playerSearch}`);
    await expect(adminPage.getByText("材料：录取通知书材料", { exact: true })).toBeVisible({ timeout: 20_000 });

    const viewEvidence = adminPage.getByRole("button", { name: "查看材料" }).last();
    await expect(viewEvidence).toBeVisible();
    const pagesBeforeEvidence = new Set(adminContext.pages());
    await viewEvidence.click();
    await expect.poll(() => adminContext.pages().some((candidate) => !pagesBeforeEvidence.has(candidate) && candidate.url().includes("education-evidence")), { timeout: 20_000 }).toBe(true);
    for (const candidate of adminContext.pages()) {
      if (!pagesBeforeEvidence.has(candidate)) await candidate.close();
    }

    const approve = adminPage.getByRole("button", { name: "通过" }).last();
    if (await approve.isVisible()) {
      adminPage.on("dialog", (dialog) => dialog.accept(""));
      await approve.click();
      await expect(adminPage.getByText("认证已通过", { exact: true })).toBeVisible({ timeout: 20_000 });
    }
    await expect(adminPage.getByText(`${player.email} · 已通过`, { exact: true })).toBeVisible({ timeout: 20_000 });
  } finally {
    await adminContext.close();
  }
});
