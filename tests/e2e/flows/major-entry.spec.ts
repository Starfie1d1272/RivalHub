import { expect, test, type E2EFixtureCredentials } from "../fixtures";

test.use({ scenarioProfile: "major-entry" });

/**
 * 2.0 真实用户任务 E2E（依赖 Local Supabase browser fixture）：
 * 每个 test attempt 都创建自己的 Local DB/Auth scenario，结束后按
 * Storage → DB → Auth 顺序清理。
 *
 * 覆盖：auth boundary（未登录访问 /my/teams 被送回登录页）→ 真实 Supabase
 * 登录 → 长期 Team 创建 → 在已发布 Major 的报名页
 * 创建 CompetitionEntry → 页面呈现与服务端 canonical 状态一致（待提交 + 报名检查），
 * 且 /my/competitions 与报名页读到同一份 Entry 状态。
 */
test.skip(({ viewport }) => (viewport?.width ?? 0) < 800, "有状态的报名流程只在桌面项目执行一次，避免并发 project 在共享 fixture 状态上竞争。");

test("队长可以登录、建立长期队伍并发起本届 Major 报名", async ({ page, scenario }) => {
  const captain = account(scenario, "captain");

  // Auth boundary：未登录访问“我的队伍”必须被送回登录页，而不是泄露页面内容。
  await page.goto("/my/teams");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("邮箱地址")).toBeVisible();

  // 真实 Supabase Auth 登录。“登录”同时命中模式切换 tab 与提交按钮，这里锁定 submit 按钮。
  await page.getByLabel("邮箱地址").fill(captain.email);
  await page.getByLabel("密码", { exact: true }).fill(scenario.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/my/teams");
  await expect(page.getByText("我的队伍", { exact: true })).toBeVisible();
  await page.goto("/my/teams");

  // 每个 scenario 从无 Team 的确定初始状态开始，创建动作必须发生。
  const createTeamButton = page.getByRole("button", { name: "创建队伍" });
  const workspace = page.getByText("队伍资料", { exact: true });
  await expect(createTeamButton).toBeVisible();
  await page.getByLabel("队伍名称").fill(`E2E 队伍 ${scenario.shortKey}`);
  await createTeamButton.click();
  // Toast 不是持久的业务状态；RSC 刷新后的 Team workspace 才证明 Server Action
  // 已成功写入并由页面重新读取 canonical Team。
  await expect(workspace).toBeVisible();

  // 每个 scenario 的报名页都没有既有 Entry，创建动作必须发生。
  await page.goto(`/${scenario.slug}/register`);
  const startEntryButton = page.getByRole("button", { name: "开始报名" });
  const entryChecklist = page.getByText("3 · 报名检查");
  await expect(startEntryButton).toBeVisible();
  await page.getByRole("combobox").click();
  await page.getByRole("option").first().click();
  await startEntryButton.click();
  await expect(page.getByText("报名记录已创建")).toBeVisible();

  // 报名页与服务端 canonical 状态一致：draft Entry 呈现「· 待提交」与报名检查。
  await expect(entryChecklist).toBeVisible();
  await expect(page.getByText(/· 待提交/)).toBeVisible();

  // “我的赛事”与报名页读到同一份 CompetitionEntry 状态（header 导航也含赛季名，取卡片）。
  await page.goto("/my/competitions");
  await expect(page.getByText(scenario.seasonName).first()).toBeVisible();
  await expect(page.getByText("赛事报名").first()).toBeVisible();
  await expect(page.getByText("待提交", { exact: true }).first()).toBeVisible();
});

function account(scenario: E2EFixtureCredentials, key: E2EFixtureCredentials["accounts"][number]["key"]): E2EFixtureCredentials["accounts"][number] {
  const value = scenario.accounts.find((candidate) => candidate.key === key);
  if (!value) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少 ${key} 账号。`);
  return value;
}
