import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type FixtureCredentials = {
  password: string;
  accounts: Array<{ key: string; email: string; userId: string }>;
};

function loadCredentials(): FixtureCredentials {
  const path = resolve(process.cwd(), ".agent-tmp", "major-browser-credentials.json");
  return JSON.parse(readFileSync(path, "utf8")) as FixtureCredentials;
}

async function signIn(page: Page, email: string, password: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("邮箱地址").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === next, { timeout: 20_000 });
}

test.skip(({ viewport }) => (viewport?.width ?? 0) < 800, "有状态的邀请流程只在桌面项目执行一次，避免并发 project 竞争共享 fixture。");

test("未入队用户可以从 /my 和 /teams 发现并处理 direct invitation", async ({ browser, page }) => {
  const credentials = loadCredentials();
  const captain = credentials.accounts.find((account) => account.key === "player2");
  const invitee = credentials.accounts.find((account) => account.key === "player1");
  if (!captain || !invitee) throw new Error("browser fixture 缺少 player2 或 player1 账号。");

  await signIn(page, captain.email, credentials.password, "/my/teams");
  const inviteeContext = await browser.newContext();
  try {
    const inviteePage = await inviteeContext.newPage();
    const captainWorkspace = page.getByText("队伍资料", { exact: true });
    const createTeamButton = page.getByRole("button", { name: "创建队伍", exact: true });
    await expect(createTeamButton.or(captainWorkspace)).toBeVisible({ timeout: 20_000 });
    let teamName: string;
    if (await createTeamButton.isVisible()) {
      teamName = `E2E 邀请队伍 ${Date.now()}`;
      await page.getByLabel("队伍名称").fill(teamName);
      await page.getByLabel("简介").fill("验证邀请入口");
      await createTeamButton.click();
      await expect(captainWorkspace).toBeVisible({ timeout: 20_000 });
    } else {
      teamName = await page.getByLabel("队伍名称").inputValue();
    }

    await signIn(inviteePage, invitee.email, credentials.password, "/my/teams");
    const inviteeWorkspace = inviteePage.getByText("队伍资料", { exact: true });
    const pendingInvitations = inviteePage.getByText("待处理邀请", { exact: true });
    const inviteeCreateTeamButton = inviteePage.getByRole("button", { name: "创建队伍", exact: true });
    await expect(inviteeWorkspace.or(pendingInvitations).or(inviteeCreateTeamButton).first()).toBeVisible({ timeout: 20_000 });
    const alreadyMember = await inviteeWorkspace.isVisible();
    const alreadyPending = await pendingInvitations.isVisible();
    if (!alreadyMember && !alreadyPending) {
      await page.getByPlaceholder("已注册邮箱").fill(invitee.email);
      await page.getByRole("button", { name: "直接邀请", exact: true }).click();
      await expect(page.getByText(invitee.email, { exact: false })).toBeVisible({ timeout: 20_000 });
    }

    await page.getByRole("button", { name: "生成单次邀请链接", exact: true }).click();
    await expect(page.getByText("单次邀请链接 · 7 天有效", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^到期时间：/)).toBeVisible();
    await expect(page.getByText("接受一次后失效；可由队长撤销。", { exact: true })).toBeVisible();

    if (alreadyMember) {
      await expect(inviteePage.getByLabel("队伍名称")).toHaveValue(teamName);
    } else {
      await inviteePage.goto("/my");
      await expect(inviteePage.getByText(/你有 \d+ 个待处理的队伍邀请/)).toBeVisible({ timeout: 20_000 });
      await expect(inviteePage.getByRole("link", { name: "处理队伍邀请", exact: true })).toHaveAttribute("href", "/my/teams");

      await inviteePage.goto("/teams");
      await expect(inviteePage.getByRole("link", { name: "处理队伍邀请", exact: true })).toHaveAttribute("href", "/my/teams");

      await inviteePage.goto("/my/teams");
      await expect(pendingInvitations).toBeVisible({ timeout: 20_000 });
      await expect(inviteePage.getByText(teamName, { exact: true })).toBeVisible();
      await expect(inviteePage.getByText("接受邀请即加入队伍，不需要再次申请或等待队长审核。", { exact: true })).toBeVisible();
      await inviteePage.getByRole("button", { name: "接受", exact: true }).click();
      await expect(inviteeWorkspace).toBeVisible({ timeout: 20_000 });
      await expect(inviteePage.getByLabel("队伍名称")).toHaveValue(teamName);
    }
  } finally {
    await inviteeContext.close();
  }
});
