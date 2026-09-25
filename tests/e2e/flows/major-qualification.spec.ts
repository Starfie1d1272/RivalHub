import type { Page } from "@playwright/test";
import { expect, signInProgrammatically, test } from "../fixtures";

test.use({ scenarioProfile: "major-qualification" });

async function finishQualificationRoundThroughAdmin(
  page: Page,
  seasonSlug: string,
  matchCount: number,
): Promise<void> {
  await page.goto(`/admin/${seasonSlug}/matches?stage=play-in`);
  const matchPaths = await page.locator(`a[href^="/admin/${seasonSlug}/matches/"]`)
    .evaluateAll((links) => links
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href)));
  const uniqueMatchPaths = [...new Set(matchPaths)];
  expect(uniqueMatchPaths).toHaveLength(matchCount);

  for (const matchPath of uniqueMatchPaths) {
    await page.goto(matchPath);
    await page.getByRole("button", { name: "判负弃赛" }).click();
    await page.getByPlaceholder("例如：超过宽限仍无法组成合法首发").fill("30→24 浏览器验收模拟赛果");
    await page.getByRole("button", { name: /弃赛$/ }).last().click();
    await expect(page.getByText("弃赛已记录")).toBeVisible();
  }
}

async function previewAndGenerateRound(
  page: Page,
  seasonSlug: string,
  round: number,
  matchCount: number,
): Promise<void> {
  await page.goto(`/admin/${seasonSlug}/prestart`);
  await page.getByRole("button", { name: `预览第 ${round} 轮` }).click();
  const preview = page.getByRole("dialog", { name: `第 ${round} 轮对阵预览` });
  await expect(preview.getByRole("listitem")).toHaveCount(matchCount);
  await preview.getByRole("button", { name: "确认并生成对阵" }).click();
  await expect(page.getByText(`第 ${round} 轮对阵已生成`)).toBeVisible();
}

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

  await expect(page.getByRole("button", { name: "预览首轮对阵" })).toBeVisible();
  await page.getByRole("button", { name: "预览首轮对阵" }).click();
  const roundPreview = page.getByRole("dialog", { name: "第 1 轮对阵预览" });
  const matchups = roundPreview.getByRole("listitem");
  await expect(matchups).toHaveCount(6);
  await expect(matchups.first()).toContainText("P1");
  await expect(matchups.first()).toContainText("P7");
  await roundPreview.getByRole("button", { name: "确认并生成对阵" }).click();
  await expect(page.getByText("第 1 轮对阵已生成")).toBeVisible();

  await page.goto(`/${scenario.slug}`);
  await expect(page.getByText("PLAY-IN", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Short Swiss · 2 胜晋级 / 2 负淘汰")).toBeVisible();
  const phases = page.getByRole("list", { name: "赛事阶段" });
  await expect(phases.getByRole("listitem", { name: "REGISTER 已完成" })).toBeVisible();
  await expect(phases.getByRole("listitem", { name: "STAGE1 待开始" })).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toHaveCount(0);

  await page.goto(`/${scenario.slug}/matches?stage=play-in`);
  await expect(page).toHaveURL(new RegExp(`/matches\\?stage=play-in$`));
  await expect(page.getByRole("tab", { name: "PLAY-IN" })).toHaveAttribute("data-state", "active");
  await expect(page.getByRole("heading", { name: "Play-in · Short Swiss" })).toBeVisible();
  for (const round of [1, 2, 3]) {
    await expect(page.getByRole("heading", { name: `第 ${round} 轮` })).toBeVisible();
  }
  await expect(page.getByRole("cell", { name: "P1", exact: true })).toBeVisible();

  await finishQualificationRoundThroughAdmin(page, scenario.slug, 6);
  await previewAndGenerateRound(page, scenario.slug, 2, 6);
  await finishQualificationRoundThroughAdmin(page, scenario.slug, 6);
  await previewAndGenerateRound(page, scenario.slug, 3, 3);
  await finishQualificationRoundThroughAdmin(page, scenario.slug, 3);

  await page.goto(`/admin/${scenario.slug}/prestart`);
  await expect(page.getByText("正赛候选 24/24")).toBeVisible();
  await page.getByRole("button", { name: "确认并同步 24 支正赛队" }).click();
  await expect(page.getByText("正赛参赛队已确认，已批准名单同步完成")).toBeVisible();
  await expect(page.getByText("已生成 15 场 · 已完成 15 场")).toBeVisible();

  await page.goto(`/${scenario.slug}/matches?stage=play-in`);
  await expect(page.getByRole("heading", { name: "Play-in · Short Swiss" })).toBeVisible();
  await expect(page.getByText("6 队晋级", { exact: false })).toBeVisible();
  for (const round of [1, 2, 3]) {
    await expect(page.getByRole("heading", { name: `第 ${round} 轮` })).toBeVisible();
  }
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
