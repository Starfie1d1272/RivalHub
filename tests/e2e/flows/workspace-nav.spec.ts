import { expect, signInProgrammatically, test } from "../fixtures";

test.use({ scenarioProfile: "auth" });

test("个人工作区导航在桌面和 390px mobile 都可达且标记当前页", async ({ page, scenario }, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chrome";
  test.skip(!mobile && testInfo.project.name !== "chromium", "该回归只在 desktop Chrome 与 390px mobile Chrome 执行。");

  const account = scenario.accounts.find((candidate) => candidate.key === "player3");
  if (!account) throw new Error(`E2E scenario ${scenario.scenarioId} 缺少稳定只读账号。`);

  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await signInProgrammatically(page, account, scenario, "/my");
  const navigation = page.getByRole("navigation", { name: "个人工作区导航" });
  const routes = [
    { href: "/my", label: "概览" },
    { href: "/my/teams", label: "我的队伍" },
    { href: "/my/competitions", label: "我的赛事" },
  ] as const;

  for (const [index, route] of routes.entries()) {
    if (index > 0) await navigation.getByRole("link", { name: route.label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${route.href.replaceAll("/", "\\/")}$`));
    await expect(navigation.getByRole("link", { name: route.label, exact: true })).toHaveAttribute("aria-current", "page");
  }

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});
