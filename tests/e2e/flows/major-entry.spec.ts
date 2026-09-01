import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 2.0 真实用户任务 E2E（依赖 Local Supabase browser fixture）：
 * `pnpm test:e2e` 会在本套件前准备 Local fixture，在结束后清理；
 * fixture 凭据只短暂写在 .agent-tmp/major-browser-credentials.json。
 *
 * 覆盖：auth boundary（未登录访问 /my/teams 被送回登录页）→ 真实 Supabase
 * 登录 → 长期 Team 创建 → 在已发布 Major 的报名页
 * 创建 CompetitionEntry → 页面呈现与服务端 canonical 状态一致（待提交 + 报名检查），
 * 且 /my/competitions 与报名页读到同一份 Entry 状态。
 */
const FIXTURE_SLUG = "local-major-browser-2026-08";
const FIXTURE_SEASON_NAME = "Local Major Browser Acceptance";

type FixtureCredentials = {
  slug: string;
  password: string;
  accounts: Array<{ key: string; email: string; userId: string }>;
};

function loadCredentials(): FixtureCredentials {
  const path = resolve(process.cwd(), ".agent-tmp", "major-browser-credentials.json");
  return JSON.parse(readFileSync(path, "utf8")) as FixtureCredentials;
}

test.skip(({ viewport }) => (viewport?.width ?? 0) < 800, "有状态的报名流程只在桌面项目执行一次，避免并发 project 在共享 fixture 状态上竞争。");

test("队长可以登录、建立长期队伍并发起本届 Major 报名", async ({ page }) => {
  const credentials = loadCredentials();
  const captain = credentials.accounts.find((account) => account.key === "captain");
  if (!captain) throw new Error("browser fixture 缺少 captain 账号。");

  // Auth boundary：未登录访问“我的队伍”必须被送回登录页，而不是泄露页面内容。
  await page.goto("/my/teams");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("邮箱地址")).toBeVisible();

  // 真实 Supabase Auth 登录。“登录”同时命中模式切换 tab 与提交按钮，这里锁定 submit 按钮。
  await page.getByLabel("邮箱地址").fill(captain.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/my\/teams/);
  await page.waitForLoadState("networkidle");

  // 长期 Team：无队时通过真实表单创建；有队时读取既有 Team。先等页面
  // 渲染出两种状态之一，避免 hydration 早期 count() 竞态。
  const createTeamButton = page.getByRole("button", { name: "创建队伍" });
  const workspace = page.getByText("队伍资料");
  await expect(createTeamButton.or(workspace)).toBeVisible();
  if (await createTeamButton.isVisible()) {
    mkdirSync(resolve(process.cwd(), ".agent-tmp"), { recursive: true });
    await page.locator("input").first().fill(`E2E 队伍 ${Date.now()}`);
    await createTeamButton.click();
    // Toast 不是持久的业务状态；RSC 刷新后的 Team workspace 才证明 Server Action
    // 已成功写入并由页面重新读取 canonical Team。
    await expect(workspace).toBeVisible({ timeout: 20_000 });
  }
  await expect(workspace).toBeVisible({ timeout: 20_000 });

  // 在已发布的 Major 报名页创建 CompetitionEntry（重复运行时读取既有 Entry）。
  await page.goto(`/${FIXTURE_SLUG}/register`);
  if (await page.getByRole("button", { name: "开始报名" }).count()) {
    await page.getByRole("combobox").click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "开始报名" }).click();
    await expect(page.getByText("报名记录已创建")).toBeVisible({ timeout: 20_000 });
  }

  // 报名页与服务端 canonical 状态一致：draft Entry 呈现「· 待提交」与报名检查。
  await expect(page.getByText("3 · 报名检查")).toBeVisible();
  await expect(page.getByText(/· 待提交/)).toBeVisible();

  // “我的赛事”与报名页读到同一份 CompetitionEntry 状态（header 导航也含赛季名，取卡片）。
  await page.goto("/my/competitions");
  await expect(page.getByText(FIXTURE_SEASON_NAME).first()).toBeVisible();
  await expect(page.getByText("赛事报名").first()).toBeVisible();
  await expect(page.getByText("待提交", { exact: true }).first()).toBeVisible();
});
