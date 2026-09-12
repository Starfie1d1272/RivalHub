import { expect, signInProgrammatically, test } from "../fixtures";

test.use({ scenarioProfile: "team-invite" });

test.skip(({ viewport }) => (viewport?.width ?? 0) < 800, "有状态的邀请流程只在桌面项目执行一次，避免并发 project 竞争共享 fixture。");

test("未入队用户可以从 /my 和 /teams 发现并处理 direct invitation", async ({ browser, page, scenario }) => {
  const captain = scenario.accounts.find((account) => account.key === "player2");
  const invitee = scenario.accounts.find((account) => account.key === "player1");
  if (!captain || !invitee) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少邀请流程账号。`);

  await signInProgrammatically(page, captain, scenario, "/my/teams");
  const inviteeContext = await browser.newContext();
  try {
    const inviteePage = await inviteeContext.newPage();
    const captainWorkspace = page.getByText("队伍资料", { exact: true });
    const teamName = scenario.invitationTeam.name;
    await expect(captainWorkspace).toBeVisible();

    await signInProgrammatically(inviteePage, invitee, scenario, "/my/teams");
    const pendingInvitations = inviteePage.getByText("待处理邀请", { exact: true });
    await page.getByPlaceholder("已注册邮箱").fill(invitee.email);
    await page.getByRole("button", { name: "直接邀请", exact: true }).click();
    await expect(page.getByText(invitee.email, { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "生成单次邀请链接", exact: true }).click();
    await expect(page.getByText("单次邀请链接 · 7 天有效", { exact: true })).toBeVisible();
    await expect(page.getByText(/^到期时间：/)).toBeVisible();
    await expect(page.getByText("接受一次后失效；可由队长撤销。", { exact: true })).toBeVisible();

    await inviteePage.goto("/my");
    await expect(inviteePage.getByText(/你有 \d+ 个待处理的队伍邀请/).first()).toBeVisible();
    await expect(inviteePage.getByRole("link", { name: "处理队伍邀请", exact: true }).first()).toHaveAttribute("href", "/my/teams");

    await inviteePage.goto("/teams");
    await expect(inviteePage.getByRole("link", { name: "处理队伍邀请", exact: true }).first()).toHaveAttribute("href", "/my/teams");

    await inviteePage.goto("/my/teams");
    await expect(pendingInvitations).toBeVisible();
    await expect(inviteePage.getByText(teamName, { exact: true })).toBeVisible();
    await expect(inviteePage.getByText("接受邀请即加入队伍，不需要再次申请或等待队长审核。", { exact: true })).toBeVisible();
    await inviteePage.getByRole("button", { name: "接受", exact: true }).click();
    await expect(inviteePage.getByText("队伍身份", { exact: true })).toBeVisible();
    await expect(inviteePage.getByRole("button", { name: "退出队伍", exact: true })).toBeVisible();
    for (const control of ["保存资料", "直接邀请", "发布招募", "交接队长", "解散队伍", "更换队伍图标"]) {
      await expect(inviteePage.getByRole("button", { name: control, exact: true })).toHaveCount(0);
    }
    await expect(inviteePage.getByRole("textbox", { name: "队伍名称", exact: true })).toHaveCount(0);
  } finally {
    await inviteeContext.close();
  }
});
