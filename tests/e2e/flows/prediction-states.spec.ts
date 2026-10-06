import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { test, expect, signInProgrammatically } from "../fixtures";
import {
  createPredictionBrowserFixture,
  removePredictionBrowserFixture,
} from "../helpers/prediction-fixture";

test.use({ scenarioProfile: "auth" });
test("模拟数据覆盖 Pick’Em 状态与隐藏规则", async ({
  page,
  scenario,
}, info) => {
  test.setTimeout(120_000);
  const user = scenario.accounts[0]!;
  let fixture = await createPredictionBrowserFixture(user.userId);
  const fixtures = [fixture];
  const pool = new Pool({
    connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL),
    ssl: false,
  });
  const mobile = info.project.name === "mobile-chrome";
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  );
  const dir = resolve(".agent-tmp/predictions-evidence");
  mkdirSync(dir, { recursive: true });
  const capture = async (name: string) => {
    // Navigation can finish while the streamed prediction board is still loading.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("正在加载观赛预测…", { exact: true })).toHaveCount(0);
    const showingMobilePick = mobile && [
      "not-joined", "empty", "draft", "submitted", "closed-submitted", "voided-submitted",
    ].includes(name);
    if (showingMobilePick) {
      await expect(page.getByText("我的阶段预测单", { exact: true })).toBeVisible();
    } else if (!name.startsWith("admin-")) {
      await expect(page.getByRole("button", { name: "晋级路径", exact: true })).toBeVisible();
      if (!name.endsWith("-results")) {
        await expect(page.locator('[data-testid^="sim-match-"]:visible').first()).toBeVisible();
      }
    }
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(dir, `${info.project.name}-${name}.png`),
      fullPage: true,
      scale: "css",
      style: "nextjs-portal { visibility: hidden; }",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  };
  const openDock = async () => {
    await page
      .getByRole("button", {
        name: mobile ? "我的预测单" : "展开预测单",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("我的阶段预测单", { exact: true }),
    ).toBeVisible();
  };
  try {
    await page.goto(`/${fixture.slug}/predictions`);
    await expect(
      page.getByText("登录参与 Pick’Em", { exact: true }),
    ).toBeVisible();
    await capture("guest");
    for (const [label, file] of [
      ["紧凑对阵", "compact"],
      ["轮次列表", "round-cards"],
      ["晋级路径", "flow"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await capture(`swiss-${file}`);
      if (!mobile && file === "compact") {
        const region = page.getByRole("region", { name: "Swiss 完整赛事推演" });
        expect(await region.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      }
    }
    await page
      .getByTestId("sim-match-stage1-r1-1")
      .getByRole("button")
      .last()
      .click();
    await capture("swiss-if");
    await page.reload();
    for (const name of ["阶段二", "阶段三", "淘汰赛"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await capture(
        name === "淘汰赛"
          ? "playoff-flow"
          : name === "阶段二"
            ? "stage2"
            : "stage3",
      );
    }
    for (const [label, file] of [
      ["紧凑对阵", "compact"],
      ["轮次列表", "round-cards"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await capture(`playoff-${file}`);
    }

    await signInProgrammatically(
      page,
      user,
      scenario,
      `/${fixture.slug}/predictions`,
    );
    await openDock();
    await capture("not-joined");
    await page
      .getByRole("button", { name: "加入 Pick’Em", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "加入 Pick’Em", exact: true }),
    ).toHaveCount(0);
    await capture("empty");
    const slots = [
      "恰好 3胜0负 1",
      "恰好 3胜0负 2",
      ...Array.from({ length: 6 }, (_, i) => `3胜1负 / 3胜2负 ${i + 1}`),
      "恰好 0胜3负 1",
      "恰好 0胜3负 2",
    ];
    for (let i = 0; i < slots.length; i++) {
      await page
        .getByRole("button", { name: new RegExp(`^${slots[i]}：`) })
        .click();
      await page
        .getByRole("button", { name: `选择 队伍 ${17 + i}`, exact: true })
        .click();
    }
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await capture("draft");
    await page.getByRole("button", { name: "提交预测", exact: true }).click();
    await expect(page.getByText("已提交", { exact: true })).toBeVisible();
    await capture("submitted");
    await pool.query(
      "UPDATE prediction_contests SET deadline=clock_timestamp()-interval '1 minute' WHERE season_id=$1",
      [fixture.seasonId],
    );
    await page.reload();
    await openDock();
    await expect(
      page.getByText("已截止，不能再提交", { exact: true }),
    ).toBeVisible();
    await capture("closed-submitted");
    await pool.query(
      "UPDATE prediction_contests SET voided_at=clock_timestamp(),void_reason='模拟赛事取消' WHERE season_id=$1",
      [fixture.seasonId],
    );
    await page.reload();
    await openDock();
    await expect(
      page.getByText("已作废：模拟赛事取消", { exact: true }),
    ).toBeVisible();
    await capture("voided-submitted");
    fixture = await createPredictionBrowserFixture(user.userId);
    fixtures.push(fixture);
    await pool.query(
      "UPDATE prediction_contests SET deadline=clock_timestamp()-interval '1 minute',voided_at=clock_timestamp(),void_reason='模拟赛事取消' WHERE season_id=$1",
      [fixture.seasonId],
    );
    await page.goto(`/${fixture.slug}/predictions`);
    await expect(
      page.getByRole("button", {
        name: mobile ? "我的预测单" : "展开预测单",
        exact: true,
      }),
    ).toHaveCount(0);
    await capture("voided-unsubmitted");
    fixture = await createPredictionBrowserFixture(user.userId);
    fixtures.push(fixture);
    await pool.query(
      "UPDATE prediction_contests SET deadline=clock_timestamp()-interval '1 minute' WHERE season_id=$1",
      [fixture.seasonId],
    );
    await page.goto(`/${fixture.slug}/predictions`);
    await expect(page.getByText("我的阶段预测单", { exact: true })).toHaveCount(
      0,
    );
    await capture("closed-unsubmitted");
    fixture = await createPredictionBrowserFixture(user.userId);
    fixtures.push(fixture);
    await page.goto(`/${fixture.slug}/predictions`);
    await pool.query(
      "UPDATE matches SET status='finished',score_a=1,score_b=0,completed_at=clock_timestamp() WHERE id=(SELECT id FROM matches WHERE season_id=$1 ORDER BY managed_key LIMIT 1)",
      [fixture.seasonId],
    );
    await page.goto(`/${fixture.slug}/predictions`);
    await expect(page.getByTestId("sim-match-stage1-r1-1")).toHaveAttribute(
      "data-source",
      "official",
    );
    await capture("official-result");
    await page.getByRole("button", { name: "紧凑对阵", exact: true }).click();
    await capture("official-result-compact");
    await page.getByRole("button", { name: "晋级路径", exact: true }).click();
    await page
      .getByTestId("sim-match-stage1-r1-1")
      .getByRole("button")
      .last()
      .click();
    await expect(page.getByTestId("sim-match-stage1-r1-1")).toHaveAttribute(
      "data-source",
      "assumption",
    );
    await capture("official-if");
    if (mobile) {
      await page.getByRole("button", { name: "轮次列表", exact: true }).click();
      await page.setViewportSize({ width: 320, height: 740 });
      await capture("round-cards-320");
      const first = await page
        .getByTestId("sim-match-stage1-r1-1")
        .boundingBox();
      const second = await page
        .getByTestId("sim-match-stage1-r1-2")
        .boundingBox();
      expect(
        first &&
          second &&
          Math.abs(first.y - second.y) < 2 &&
          second.x > first.x,
      ).toBe(true);
      await expect(page.getByTestId("sim-match-stage1-r2-1")).toBeHidden();
      await page
        .getByRole("button", { name: "展示第 3 轮", exact: true })
        .click();
      await expect(page.getByTestId("sim-match-stage1-r3-1")).toBeVisible();
      await capture("round-cards-320-r3");
      await page.getByRole("button", { name: "结果", exact: true }).click();
      await capture("round-cards-320-results");

      await page.setViewportSize({ width: 390, height: 844 });
    }
  } finally {
    await pool.end();
    for (const item of fixtures)
      await removePredictionBrowserFixture(item.seasonId);
  }
});
