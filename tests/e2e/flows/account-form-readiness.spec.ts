import { test, expect } from "../fixtures";

test.use({ scenarioProfile: "auth" });
test("设置页面的安全、竞技和教育表单可操作", async ({ page, scenario }) => {
  test.setTimeout(120000);
  const account = scenario.accounts.find(row => row.key === "player3")!;
  expect((await page.request.post("/api/test/e2e/auth", { data: { email: account.email, password: scenario.password } })).ok()).toBe(true);
  for (const route of ["/settings/security", "/settings/competitive", "/settings/education"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const form = route.endsWith("security") ? page.getByLabel("新密码", { exact: true }) : route.endsWith("education") ? page.getByLabel("学信网在线验证码") : page.getByRole("button", { name: "保存竞技档案", exact: true });
    await expect(form).toBeVisible();
    await expect(form).toBeEnabled();
  }
});
