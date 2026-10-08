import { test, expect, signInProgrammatically } from "../fixtures";
test.use({ scenarioProfile: "auth" });
test.setTimeout(120_000);
import { readFileSync } from "node:fs";
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
    const matchLink = identityCard.getByRole("link", { name: /查看 .* 比赛/ });
    await expect(identityCard.getByRole("link")).toHaveCount(1);
    await expect(matchLink).toHaveAttribute("href", new RegExp(`^/${fixture.slug}/matches/`));
    await matchLink.focus(); await matchLink.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${fixture.slug}/matches/`));
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
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.getByText(/^已提交 · 有未提交修改$/)).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出图片", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain("草稿");
    const downloadPath = await file.path();
    if (!downloadPath) throw new Error("PNG export has no local file");
    expect(readFileSync(downloadPath).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await page.reload();
    if (mobile) await page.getByRole("button", { name: "我的预测单", exact: true }).click();
    else await page.getByRole("button", { name: "展开预测单", exact: true }).click();
    await expect(page.getByRole("button", { name: "恰好 3胜0负 1：队伍 32", exact: true })).toBeVisible();
    await expect(page.getByText(/^已提交 · 有未提交修改$/)).toBeVisible();
  } finally {
    await removePredictionBrowserFixture(fixture.seasonId);
  }
});
