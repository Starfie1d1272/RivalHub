import { expect, test, signInProgrammatically } from "../fixtures";

test.use({ scenarioProfile: "stats" });

test("超级管理员可查看健康证据及未核验状态", async ({ page, scenario }) => {
  await signInProgrammatically(page, scenario.accounts.find(account => account.key === "admin")!, scenario, "/admin/settings");
  const section = page.getByRole("region", { name: "服务健康与证据覆盖" });
  await expect(section).toBeVisible();
  for (const name of ["认证", "报名", "赛果更正", "定时任务", "完整性", "依赖与备份保障"]) {
    await expect(section.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(section.getByText("未核验").first()).toBeVisible();
  await expect(section.getByRole("link", { name: "查看产品遥测" })).toHaveAttribute("href", "/admin/telemetry");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
