import { test, expect } from "@playwright/test";
test.setTimeout(120_000);
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPredictionBrowserFixture,
  removePredictionBrowserFixture,
} from "../helpers/prediction-fixture";
test("观众完成选队提交、草稿隔离、图片导出与真实积分投入", async ({
  page,
}, info) => {
  const credentials = JSON.parse(
    readFileSync(resolve(".agent-tmp/major-browser-credentials.json"), "utf8"),
  ) as {
    password: string;
    accounts: { key: string; email: string; userId: string }[];
  };
  const user = credentials.accounts.find((a) => a.key === "captain")!;
  const fixture = await createPredictionBrowserFixture(user.userId);
  try {
    await page.goto(
      `/login?next=${encodeURIComponent(`/${fixture.slug}/predictions`)}`,
    );
    await page.getByLabel("邮箱地址").fill(user.email);
    await page.getByLabel("密码", { exact: true }).fill(credentials.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => url.pathname.endsWith("/predictions"));
    await page.goto(`/${fixture.slug}/predictions`);
    await expect(
      page.getByRole("heading", { name: /观赛预测验收赛/ }),
    ).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: /免费加入/ }).click();
    await expect(page.getByRole("button", { name: /免费加入/ })).toHaveCount(0);
    const mobile = info.project.name === "mobile-chrome";
    if (mobile)
      await page
        .getByRole("button", { name: "我的预测单", exact: true })
        .click();
    const slotNames = [
      "恰好 3胜0负 1",
      "恰好 3胜0负 2",
      ...Array.from({ length: 6 }, (_, i) => `3胜1负 / 3胜2负 ${i + 1}`),
      "恰好 0胜3负 1",
      "恰好 0胜3负 2",
    ];
    for (let i = 0; i < slotNames.length; i++) {
      await page
        .getByRole("button", { name: new RegExp(`^${slotNames[i]}：`) })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: `队伍 ${17 + i}`, exact: true })
        .click();
    }
    await page.getByRole("button", { name: "提交预测", exact: true }).click();
    await expect(page.getByText(/已提交 · 版本/)).toBeVisible();
    await page.getByRole("button", { name: /^恰好 3胜0负 1：/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "队伍 32", exact: true })
      .click();
    await expect(page.getByText(/有未提交修改/)).toBeVisible();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByText(/已提交 · 版本 1/)).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出图片", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain("草稿");
    mkdirSync(resolve(".agent-tmp/predictions-evidence"), { recursive: true });
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
      timeout: 10000,
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(
        `.agent-tmp/predictions-evidence/${info.project.name}-pick.png`,
      ),
      fullPage: true,
    });
    await page.getByRole("button", { name: "单场积分", exact: true }).click();
    await page.getByLabel("投入积分", { exact: true }).fill("100");
    await page.getByRole("button", { name: "确认投入", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "确认继续" })
      .click();
    await expect(page.getByText(/我已投入 100/)).toBeVisible();
    await page.getByRole("button", { name: "我的战绩", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "-100", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
  }
});

test("完整推演导入提交，上游修改不会改写提交，分享快照可恢复", async ({
  page,
}, info) => {
  const credentials = JSON.parse(
    readFileSync(resolve(".agent-tmp/major-browser-credentials.json"), "utf8"),
  ) as {
    password: string;
    accounts: { key: string; email: string; userId: string }[];
  };
  const user = credentials.accounts.find((a) => a.key === "player1")!;
  const fixture = await createPredictionBrowserFixture(user.userId);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(
      `/login?next=${encodeURIComponent(`/${fixture.slug}/predictions`)}`,
    );
    await page.getByLabel("邮箱地址").fill(user.email);
    await page.getByLabel("密码", { exact: true }).fill(credentials.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => url.pathname.endsWith("/predictions"));
    await page.getByRole("button", { name: /免费加入/ }).click();
    await expect(page.getByRole("button", { name: /免费加入/ })).toHaveCount(0);
    const mobile = info.project.name === "mobile-chrome";
    for (let round = 1; round <= 5; round++) {
      if (mobile) await page.getByLabel("当前轮次").selectOption(String(round));
      for (let slot = 1; slot <= [8, 8, 8, 6, 3][round - 1]!; slot++) {
        const card = page.getByTestId(`sim-match-stage1-r${round}-${slot}`);
        const button = card.getByRole("button").first();
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
      }
    }
    await page
      .getByRole("button", { name: "将本阶段结果填入预测单 →" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "确认继续" })
      .click();
    await page.getByRole("button", { name: "提交预测", exact: true }).click();
    await expect(page.getByText(/已提交 · 版本 1/)).toBeVisible();
    if (mobile) {
      await page.getByRole("button", { name: "推演", exact: true }).click();
      await page.getByLabel("当前轮次").selectOption("1");
    }
    await page
      .getByTestId("sim-match-stage1-r1-1")
      .getByRole("button")
      .last()
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "确认继续" })
      .click();
    await expect(page.getByTestId("sim-match-stage1-r3-1")).toHaveCount(0);
    await page.getByLabel("推演名称").fill("我的晋级路径");
    await page.getByRole("button", { name: "保存推演并分享" }).click();
    await expect(
      page.getByText("保存的推演 · 我的晋级路径", { exact: true }),
    ).toBeVisible();
    if (mobile)
      await page
        .getByRole("button", { name: "我的预测单", exact: true })
        .click();
    await expect(page.getByText(/已提交 · 版本 1/)).toBeVisible();
    await expect(page.getByText(/有未提交修改/)).toHaveCount(0);
    if (mobile)
      await page.getByRole("button", { name: "推演", exact: true }).click();
    await page.getByRole("link", { name: "打开分享快照" }).click();
    await expect(page).toHaveURL(/scenario=/);
    await expect(
      page.getByText("保存的推演 · 我的晋级路径", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("sim-match-stage1-r1-1").getByRole("button").last(),
    ).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
  }
});

test("赛事管理员冻结配置、开窗、暂停和作废阶段", async ({ page }) => {
  const credentials = JSON.parse(
    readFileSync(resolve(".agent-tmp/major-browser-credentials.json"), "utf8"),
  ) as {
    password: string;
    accounts: { key: string; email: string; userId: string }[];
  };
  const user = credentials.accounts.find((a) => a.key === "player2")!;
  const fixture = await createPredictionBrowserFixture(user.userId, true);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(
      `/login?next=${encodeURIComponent(`/admin/${fixture.slug}/predictions`)}`,
    );
    await page.getByLabel("邮箱地址").fill(user.email);
    await page.getByLabel("密码", { exact: true }).fill(credentials.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => url.pathname.endsWith("/predictions"));
    await page.getByRole("button", { name: "冻结规则并开放" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "确认继续" })
      .click();
    await expect(page.getByLabel("首次免费积分")).toBeDisabled();
    const future = new Date(Date.now() + 1800000);
    const local = new Date(
      future.getTime() - future.getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
    await page.getByLabel("截止时间（本机时区）").fill(local);
    await page
      .getByRole("button", { name: "开放阶段 Pick’Em", exact: true })
      .first()
      .click();
    await expect(page.getByText(/已开放 ·/)).toBeVisible();
    await page
      .getByRole("button", { name: "开放积分池", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "积分池已创建", exact: true }),
    ).toHaveCount(1);
    await page.getByLabel("操作理由").fill("本地验收暂停");
    await page.getByRole("button", { name: "暂停新提交与投入" }).click();
    await expect(
      page.getByRole("button", { name: "恢复新提交与投入" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^作废 / }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "确认继续" })
      .click();
    await expect(page.getByText(/已作废：本地验收暂停/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
  }
});
