import { expect, signInProgrammatically, test } from "../fixtures";

test.use({ scenarioProfile: "major-qualification" });

test("管理员预览并确认 30 队到 Major 24 的 Play-in 配置与首轮对阵", async ({ page, scenario }) => {
  test.setTimeout(120_000);
  const admin = scenario.accounts.find((account) => account.key === "admin");
  if (!admin) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少管理员账号。`);

  await signInProgrammatically(page, admin, scenario, `/admin/${scenario.slug}/prestart`);
  await expect(page.getByRole("button", { name: "预览 Play-in 配置" })).toBeVisible();
  await page.getByRole("combobox", { name: "赛制" }).click();
  await page.getByRole("option", { name: /Short Swiss BO1 · 2 胜晋级 \/ 2 负淘汰/ }).click();
  await page.getByRole("button", { name: "预览 Play-in 配置" }).click();

  const configurationPreview = page.getByRole("dialog", { name: "Play-in 配置预览" });
  await expect(configurationPreview.getByText(/正赛容量\s*24/)).toBeVisible();
  await expect(configurationPreview.getByText(/已批准候选\s*30/)).toBeVisible();
  await expect(configurationPreview.getByText(/直通正赛\s*18/)).toBeVisible();
  await expect(configurationPreview.getByText(/参加 Play-in\s*12/)).toBeVisible();
  await expect(configurationPreview.getByText(/晋级名额\s*6/)).toBeVisible();
  await expect(configurationPreview.getByRole("row").filter({ hasText: "P18" })).toContainText("直通正赛");
  await expect(configurationPreview.getByRole("row").filter({ hasText: "P19" })).toContainText("Play-in");
  await configurationPreview.getByRole("button", { name: "确认并锁定配置" }).click();
  const directEntrantRow = page.getByRole("row").filter({ hasText: "直通正赛" }).first();
  await expect(directEntrantRow.getByRole("cell").nth(4)).toHaveText("直通正赛");

  await page.goto(`/${scenario.slug}`);
  await expect(page.getByText("30 支候选 · 24 支正赛")).toBeVisible();
  await expect(page.getByText("赛程待生成", { exact: true })).toBeVisible();
  await page.goto(`/admin/${scenario.slug}/prestart`);

  await expect(page.getByRole("button", { name: "预览首轮对阵" })).toBeVisible();
  await page.getByRole("button", { name: "预览首轮对阵" }).click();
  const roundPreview = page.getByRole("dialog", { name: "第 1 轮对阵预览" });
  const matchups = roundPreview.getByRole("listitem");
  await expect(matchups).toHaveCount(6);
  await expect(matchups.first()).toContainText("P1");
  await expect(matchups.first()).toContainText("P7");
  await roundPreview.getByRole("button", { name: "确认并生成对阵" }).click();
  await expect(page.getByText("第 1 轮对阵已生成")).toBeVisible();

  await page.goto(`/admin/${scenario.slug}/matches?stage=play-in`);
  await expect(page.getByRole("tab", { name: "PLAY-IN" })).toHaveAttribute("data-state", "active");
  const activeStagePanel = page.locator('[role="tabpanel"][data-state="active"]');
  const matchPaths = await activeStagePanel.locator(`a[href^="/admin/${scenario.slug}/matches/"]`)
    .evaluateAll((links) => links
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href)));
  expect([...new Set(matchPaths)]).toHaveLength(6);

  await page.goto(`/${scenario.slug}`);
  await expect(page.getByText("PLAY-IN", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Play-in 进行中")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();
  await expect(page.getByText("12 支争夺 6 个正赛席位")).toBeVisible();
  const phases = page.getByRole("list", { name: "赛事阶段" });
  await expect(phases.getByRole("listitem", { name: "REGISTER 已完成" })).toBeVisible();
  await expect(phases.getByRole("listitem", { name: "STAGE1 待开始" })).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toHaveCount(0);

  await page.goto(`/${scenario.slug}/matches?stage=play-in`);
  await expect(page).toHaveURL(new RegExp(`/matches\\?stage=play-in$`));
  await expect(page.getByRole("tab", { name: "PLAY-IN" })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("heading", { name: "PLAY-IN" })).toBeVisible();
  await expect(page.getByText("12 → 6 · BO1 · 2胜晋级 / 2负淘汰 · Round 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "第 1 轮" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "P1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Buchholz 说明" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("下一轮组内配对顺序");
});

test("Direct BO3 使用镜像种子且公开展示晋级摘要", async ({ page, scenario }) => {
  const admin = scenario.accounts.find((account) => account.key === "admin");
  if (!admin) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少管理员账号。`);

  await signInProgrammatically(page, admin, scenario, `/admin/${scenario.slug}/prestart`);
  await page.getByRole("button", { name: "预览 Play-in 配置" }).click();
  const configurationPreview = page.getByRole("dialog", { name: "Play-in 配置预览" });
  await expect(configurationPreview.getByText(/赛制\s*Direct BO3/)).toBeVisible();
  await configurationPreview.getByRole("button", { name: "确认并锁定配置" }).click();
  await page.getByRole("button", { name: "预览首轮对阵" }).click();

  const roundPreview = page.getByRole("dialog", { name: "第 1 轮对阵预览" });
  const matchups = roundPreview.getByRole("listitem");
  await expect(matchups).toHaveCount(6);
  await expect(matchups.nth(0)).toContainText("P1");
  await expect(matchups.nth(0)).toContainText("P12");
  await expect(matchups.nth(1)).toContainText("P2");
  await expect(matchups.nth(1)).toContainText("P11");
  await roundPreview.getByRole("button", { name: "确认并生成对阵" }).click();

  await page.goto(`/${scenario.slug}/matches?stage=play-in`);
  await expect(page.getByRole("tab", { name: "PLAY-IN" })).toHaveAttribute("data-state", "active");
  await expect(page.getByText("PLAY-IN · 12 → 6 · BO3 决胜赛")).toBeVisible();
  await page.goto(`/${scenario.slug}/matches?stage=stage1`);
  await expect(page.getByRole("tab", { name: "STAGE1" })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("tab", { name: "PLAY-IN" })).toHaveAttribute("data-state", "inactive");
});
