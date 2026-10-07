import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { test, expect, signInProgrammatically } from "../fixtures";
test.use({ scenarioProfile: "auth" });
test.setTimeout(120_000);
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPredictionBrowserFixture,
  removePredictionBrowserFixture,
} from "../helpers/prediction-fixture";
test("观众完成选队提交、草稿隔离、图片导出", async ({
  page,
  scenario,
}, info) => {
  const user = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(user.userId);
  try {
    await signInProgrammatically(
      page,
      user,
      scenario,
      `/${fixture.slug}/predictions`,
    );
    await page.goto(`/${fixture.slug}/predictions`);
    await expect(
      page.getByRole("heading", { name: /观赛预测验收赛/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /加入 Pick’Em/ }).click();
    await expect(
      page.getByRole("button", { name: /加入 Pick’Em/ }),
    ).toHaveCount(0);
    const mobile = info.project.name === "mobile-chrome";
    const identityCard = page.getByTestId("sim-match-stage1-r1-1");
    await expect(identityCard.locator("a a, button a, a button, button button")).toHaveCount(0);
    const profile = identityCard.getByRole("link").first();
    await expect(profile).toHaveAttribute("href", new RegExp(`^/${fixture.slug}/teams/`));
    await profile.focus(); await profile.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${fixture.slug}/teams/`));
    await page.goBack();
    await expect(identityCard).toHaveAttribute("data-source", "preview");

    if (mobile)
      await page
        .getByRole("button", { name: "我的预测单", exact: true })
        .click();
    else
      await page
        .getByRole("button", { name: "展开预测单", exact: true })
        .click();
    const slotNames = [
      "恰好 3胜0负 1",
      "恰好 3胜0负 2",
      ...Array.from({ length: 6 }, (_, i) => `3胜1负 / 3胜2负 ${i + 1}`),
      "恰好 0胜3负 1",
      "恰好 0胜3负 2",
    ];
    // Desktop exercises actual HTML drag/drop; keyboard is the touch-independent path.
    if (!mobile) {
      await page.setViewportSize({ width: 1280, height: 1719 });
      await page
        .getByRole("button", { name: "选择 队伍 17", exact: true })
        .dragTo(page.getByRole("button", { name: /^恰好 3胜0负 1：/ }));
      await expect(
        page.getByRole("button", {
          name: "恰好 3胜0负 1：队伍 17",
          exact: true,
        }),
      ).toBeVisible();
    }
    for (let i = mobile ? 0 : 1; i < slotNames.length; i++) {
      const slot = page.getByRole("button", {
        name: new RegExp(`^${slotNames[i]}：`),
      });
      // Keyboard press does not wait for enabled state, unlike a user click.
      await expect(slot).toBeEnabled();
      await slot.press("Enter");
      await expect(slot).toHaveAttribute("aria-pressed", "true");
      await page
        .getByRole("button", { name: `选择 队伍 ${17 + i}`, exact: true })
        .press("Enter");
      await expect(slot).toHaveAccessibleName(
        `${slotNames[i]}：队伍 ${17 + i}`,
      );
    }
    await page.getByRole("button", { name: "提交预测", exact: true }).click();
    await expect(page.getByText(/^已提交$/)).toBeVisible();
    await page.getByRole("button", { name: /^恰好 3胜0负 1：/ }).click();
    await page
      .getByRole("button", { name: "选择 队伍 32", exact: true })
      .click();
    await expect(page.getByText(/有未提交修改/)).toBeVisible();
    await page.screenshot({
      path: resolve(
        `.agent-tmp/predictions-evidence/${info.project.name}-dirty.png`,
      ),
      fullPage: true,
      scale: "css",
      style: "nextjs-portal { visibility: hidden; }",
    });
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByText(/^已提交 · 有未提交修改$/)).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出图片", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain("草稿");
    await file.saveAs(
      resolve(`.agent-tmp/predictions-evidence/${info.project.name}-share.png`),
    );
    mkdirSync(resolve(".agent-tmp/predictions-evidence"), { recursive: true });
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
      timeout: 10000,
    });
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1280, height: 1719 },
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    if (mobile)
      await page
        .getByText("我的阶段预测单", { exact: true })
        .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(
        `.agent-tmp/predictions-evidence/${info.project.name}-pick.png`,
      ),
      fullPage: false,
      scale: "css",
      style: "nextjs-portal { visibility: hidden; }",
    });
    await page.screenshot({
      path: resolve(
        `.agent-tmp/predictions-evidence/${info.project.name}-full.png`,
      ),
      fullPage: true,
      scale: "css",
      style: "nextjs-portal { visibility: hidden; }",
    });
    await expect(
      page.getByRole("button", { name: "单场积分", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "我的战绩", exact: true }).click();
    await expect(page.getByText("观赛成就", { exact: true })).toBeVisible();
    await expect(page.getByText(/我的积分流水/)).toHaveCount(0);
    await page.screenshot({
      path: resolve(
        `.agent-tmp/predictions-evidence/${info.project.name}-record.png`,
      ),
      fullPage: true,
      scale: "css",
      style: "nextjs-portal { visibility: hidden; }",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
  }
});

test("完整推演导入提交，上游修改不会改写提交，刷新恢复官方赛况", async ({
  page,
  scenario,
}, info) => {
  const user = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(user.userId);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await signInProgrammatically(
      page,
      user,
      scenario,
      `/${fixture.slug}/predictions`,
    );
    await page.getByRole("button", { name: /加入 Pick’Em/ }).click();
    await expect(
      page.getByRole("button", { name: /加入 Pick’Em/ }),
    ).toHaveCount(0);
    const mobile = info.project.name === "mobile-chrome";
    await expect(page.getByTestId("sim-match-stage1-r5-3")).toHaveCount(1);
    await expect(page.getByTestId("sim-match-stage1-r5-3")).toHaveAttribute(
      "data-source",
      "preview",
    );
    for (let round = 1; round <= 5; round++) {
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
    await expect(page.getByText(/^已提交$/)).toBeVisible();
    if (mobile) {
      await page.getByRole("button", { name: "推演", exact: true }).click();
    }
    await page
      .getByTestId("sim-match-stage1-r1-1")
      .getByRole("button")
      .last()
      .click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByTestId("sim-match-stage1-r3-1")).toHaveAttribute(
      "data-source",
      "preview",
    );
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByTestId("sim-match-stage1-r5-3")).toHaveAttribute(
      "data-source",
      "assumption",
    );
    await expect(
      page.getByText("我的选择 33 场", { exact: false }),
    ).toBeVisible();
    await page
      .getByTestId("sim-match-stage1-r1-1")
      .getByRole("button")
      .last()
      .click();
    if (mobile)
      await page
        .getByRole("button", { name: "我的预测单", exact: true })
        .click();

    await expect(page.getByText(/^已提交$/)).toBeVisible();
    await expect(page.getByText(/有未提交修改/)).toHaveCount(0);
    if (mobile)
      await page.getByRole("button", { name: "推演", exact: true }).click();
    await page.reload();
    await expect(page.getByTestId("sim-match-stage1-r1-1")).toHaveAttribute(
      "data-source",
      "preview",
    );
    await expect(page.getByText("我的选择 0 场")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "保存推演并分享" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "淘汰赛", exact: true }).click();
    await expect(page.getByTestId("sim-match-playoff-final-1")).toHaveAttribute(
      "data-source",
      "preview",
    );
    await page
      .getByTestId("sim-match-playoff-qf-1")
      .getByRole("button")
      .last()
      .click();
    await expect(page.getByTestId("sim-match-playoff-qf-1")).toHaveAttribute(
      "data-source",
      "assumption",
    );
    await expect(page.getByTestId("sim-match-playoff-final-1")).toHaveAttribute(
      "data-source",
      "preview",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await page.screenshot({
      path: resolve(
        `.agent-tmp/predictions-evidence/${info.project.name}-playoff.png`,
      ),
      fullPage: true,
      scale: "css",
      style: "nextjs-portal { visibility: hidden; }",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
  }
});

test("紧凑推演在窄屏能滚到结果并回到首轮", async ({ page, scenario }, info) => {
  const user = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(user.userId);
  try {
    await signInProgrammatically(page, user, scenario, `/${fixture.slug}/predictions`);
    await page.getByRole("button", { name: "紧凑对阵", exact: true }).click();
    const flow = page.getByRole("region", { name: "Swiss 完整赛事推演" });
    for (const width of [390, 320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width === 1440) expect(await flow.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await flow.evaluate(element => { element.scrollLeft = 0; });
      const first = flow.getByRole("heading", { name: "第 1 轮", exact: true });
      const startsInside = async () => {
        const container = await flow.boundingBox();
        const heading = await first.boundingBox();
        return !!container && !!heading && heading.x >= container.x - 1 && heading.x + heading.width <= container.x + container.width + 1;
      };
      await expect.poll(startsInside).toBe(true);
      await flow.evaluate(element => { element.scrollLeft = element.scrollWidth; });
      const last = flow.getByRole("region", { name: "最终结果" });
      await expect.poll(async () => {
        const container = await flow.boundingBox();
        const result = await last.boundingBox();
        return !!container && !!result && result.x >= container.x - 1 && result.x + result.width <= container.x + container.width + 1;
      }).toBe(true);
      await flow.evaluate(element => { element.scrollLeft = 0; });
      await expect.poll(startsInside).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      if (width === 320) await info.attach("compact-first-round-320", { body: await page.screenshot({ fullPage: true, style: "nextjs-portal { visibility: hidden; }" }), contentType: "image/png" });
    }
    await flow.getByTestId("sim-match-stage1-r1-1").getByRole("button").last().click();
    await expect(flow.getByTestId("sim-match-stage1-r1-1")).toHaveAttribute("data-source", "assumption");
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
  }
});

test("Pick’Em 跟随官方排期，未排期可提交，实际开赛后关闭", async ({ page, scenario }) => {
  const user = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(user.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  try {
    await pool.query("UPDATE matches SET scheduled_at=NULL WHERE season_id=$1", [fixture.seasonId]);
    await signInProgrammatically(page, user, scenario, `/${fixture.slug}/predictions`);
    await page.getByRole("button", { name: test.info().project.name === "mobile-chrome" ? "我的预测单" : "展开预测单", exact: true }).click();
    await expect(page.getByText("截止：时间待公布", { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(`.agent-tmp/predictions-evidence/${test.info().project.name}-deadline-unpublished.png`), fullPage: true, scale: "css", style: "nextjs-portal { visibility: hidden; }" });
    await expect(page.getByRole("button", { name: "加入 Pick’Em", exact: true })).toBeEnabled();
    await pool.query("UPDATE matches SET scheduled_at=clock_timestamp()+interval '2 hours' WHERE season_id=$1", [fixture.seasonId]);
    await page.reload();
    await page.getByRole("button", { name: test.info().project.name === "mobile-chrome" ? "我的预测单" : "展开预测单", exact: true }).click();
    await expect(page.getByText("截止：时间待公布", { exact: true })).toHaveCount(0);
    await pool.query("UPDATE matches SET status='in_progress' WHERE id=(SELECT id FROM matches WHERE season_id=$1 ORDER BY managed_key LIMIT 1)", [fixture.seasonId]);
    await page.reload();
    await expect(page.getByTestId("sim-match-stage1-r1-1")).toBeVisible();
    await expect(page.getByRole("button", { name: "展开预测单", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "我的预测单", exact: true })).toHaveCount(0);
  } finally {
    await pool.end();
    await removePredictionBrowserFixture(fixture.seasonId);
  }
});

test("官方 Swiss 与推演共享布局，Play-in 六场与未来路径在桌面和手机均可访问", async ({ page, scenario }, info) => {
  const user = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(user.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  try {
    const { generateShortSwissRoundPairings } = await import("../../../src/lib/competition-qualification/swiss");
    const entries = (await pool.query<{id:string}>("SELECT id FROM competition_entries WHERE competition_id=$1 ORDER BY name LIMIT 12", [fixture.seasonId])).rows;
    const run = (await pool.query<{id:string}>("INSERT INTO competition_qualification_runs (season_id,format,target_entrant_count,candidate_count,direct_entry_count,play_in_entry_count,qualifier_count,configured_by) VALUES ($1,'short_swiss_2w2l',6,12,0,12,6,'browser-fixture') RETURNING id", [fixture.seasonId])).rows[0]!;
    for (const [index, entry] of entries.entries()) await pool.query("INSERT INTO competition_qualification_entrants (run_id,season_id,competition_entry_id,preliminary_seed) VALUES ($1,$2,$3,$4)", [run.id,fixture.seasonId,entry.id,index+1]);
    const pairs = generateShortSwissRoundPairings({entrants:entries.map((entry,i)=>({teamId:entry.id,initialSeed:i+1})),matches:[],completedRound:0});
    for (const pair of pairs) await pool.query("INSERT INTO matches (season_id,entry_a_id,entry_b_id,stage,format,round,qualification_run_id) VALUES ($1,$2,$3,'play-in','bo1',1,$4)", [fixture.seasonId,pair.higherSeedTeamId,pair.lowerSeedTeamId,run.id]);
    await signInProgrammatically(page,user,scenario,`/${fixture.slug}/matches`);
    await page.goto(`/${fixture.slug}/matches`);
    await page.getByRole("tab", {name:"PLAY-IN",exact:true}).click();
    const flow = page.getByRole("region", {name:"Swiss 官方赛程"});
    await expect(flow.getByRole("link")).toHaveCount(6);
    await expect(flow.getByTestId("record-2-1–0")).toContainText("待定");
    const widths = info.project.name === "mobile-chrome" ? [390,320] : [1440,1680,1920];
    for (const width of widths) {
      await page.setViewportSize({width,height:1000});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
      const tabs=page.getByRole("tablist").first();
      expect(await tabs.evaluate(element=>getComputedStyle(element).overflowY)).toBe("hidden");
      await info.attach(`swiss-${width}`, {body:await page.screenshot({fullPage:true,animations:"disabled",style:"nextjs-portal { visibility: hidden; }"}),contentType:"image/png"});
    }
    await page.getByRole("button",{name:"轮次列表",exact:true}).click();
    if (info.project.name === "mobile-chrome") {
      await page.getByRole("button",{name:"展示第 3 轮"}).press("Enter");
      await expect(flow.getByTestId("record-3-1–1")).toBeVisible();
      await page.getByRole("button",{name:"结果",exact:true}).press("Enter");
      await expect(flow.getByRole("region",{name:"最终结果"})).toBeVisible();
    }
    await page.getByRole("tab").filter({hasText:/stage\s*1|阶段一|第一阶段/i}).first().click();
    await expect(flow.getByRole("link")).toHaveCount(8);
    await expect(flow.getByRole("region",{name:"最终结果"})).toContainText("3–0");
  } finally {
    await pool.query("DELETE FROM matches WHERE season_id=$1 AND qualification_run_id IS NOT NULL", [fixture.seasonId]);
    await pool.query("DELETE FROM competition_qualification_entrants WHERE season_id=$1", [fixture.seasonId]);
    await pool.query("DELETE FROM competition_qualification_runs WHERE season_id=$1", [fixture.seasonId]);
    await pool.end();
    await removePredictionBrowserFixture(fixture.seasonId);
  }
});
