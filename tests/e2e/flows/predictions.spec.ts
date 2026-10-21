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
      page.getByRole("heading", { name: "赛事推演", exact: true }),
    ).toBeVisible();
    const achievement = page.getByTestId("pickem-achievement");
    await expect(achievement).toBeVisible();
    await achievement.getByRole("button", { name: "任务", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "任务列表" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(achievement.getByRole("button", { name: "任务", exact: true })).toBeFocused();
    await achievement.getByRole("button", { name: "放大我的纪念币" }).click();
    const medal = page.getByRole("dialog", { name: "我的纪念币" });
    await expect(medal).toBeVisible();
    await medal.getByRole("tab", { name: "排行榜", exact: true }).click();
    await expect(medal.getByText("完成任务", { exact: true })).toBeVisible();
    await medal.getByRole("button", { name: "Close", exact: true }).click();
    await expect(achievement.getByRole("button", { name: "放大我的纪念币" })).toBeFocused();
    const hypothetical = page.locator('[data-testid^="sim-match-stage1-r2-"]').first();
    await expect(hypothetical.getByRole("link", { name: /队伍资料/ })).toHaveCount(2);
    await expect(hypothetical.locator("a a, button a, a button, button button")).toHaveCount(0);
    const mobile = info.project.name === "mobile-chrome";
    const identityCard = page.getByTestId("sim-match-stage1-r1-1");
    await expect(identityCard.locator("a a, button a, a button, button button")).toHaveCount(0);
    const matchLink = identityCard.getByRole("link", { name: /查看 .* 比赛/ });
    await expect(identityCard.getByRole("link")).toHaveCount(1);
    await expect(matchLink).toHaveAttribute("href", new RegExp(`^/${fixture.slug}/matches/`));
    // This suite runs against next dev. Compile the destination document before
    // timing keyboard navigation: the cold match route races the parallel BET
    // compilation on CI, while the same route passes immediately on retry.
    const matchHref = await matchLink.getAttribute("href");
    const destination = await page.request.get(matchHref!);
    expect(destination.status()).toBe(200);
    await expect(medal).toBeHidden();
    await matchLink.focus();
    await expect(matchLink).toBeFocused();
    await matchLink.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${fixture.slug}/matches/`));
    await page.goBack();
    await expect(identityCard).toHaveAttribute("data-source", "preview");

    await page.getByRole("button", { name: "保存推演为 Pick’Em", exact: true }).click();
    await expect(page.getByText("已保存当前推演 · 草稿未提交", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "恰好 3胜0负 1：队伍 17", exact: true })).toBeVisible();
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
