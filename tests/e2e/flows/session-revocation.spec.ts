import { createClient } from "@supabase/supabase-js";
import { expect, signInProgrammatically, test } from "../fixtures";
import { assertLocalHttpUrl } from "../../../scripts/db/local-environment";
import { requireSupabaseSecretKey } from "../../../src/lib/runtime/supabase-keys";

test.use({ scenarioProfile: "auth" });
test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "chromium", "会话语义在两个独立桌面 browser context 验证。"); });

test("logout rejects a saved cookie while another login survives; changing password revokes both", async ({ page, browser, scenario }) => {
  const account = scenario.accounts[0]!;
  const otherContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" });
  const other = await otherContext.newPage();
  try {
    await signInProgrammatically(page, account, scenario, "/settings/security");
    await signInProgrammatically(other, account, scenario, "/settings/security");
    const saved = await page.context().cookies();
    await page.getByRole("button", { name: "账号菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("link", { name: "登录", exact: true }).first()).toBeVisible();
    await page.context().addCookies(saved);
    await page.goto("/settings/security");
    await expect(page).toHaveURL(/\/login/);
    await other.reload();
    await expect(other).toHaveURL(/\/settings\/security$/);
    await signInProgrammatically(page, account, scenario, "/settings/security");
    const beforeChange = await page.context().cookies();
    await page.getByLabel("原密码", { exact: true }).fill(scenario.password);
    await page.getByLabel("新密码", { exact: true }).fill("New-Session-Password-7!");
    await page.getByLabel("确认新密码", { exact: true }).fill("New-Session-Password-7!");
    await page.getByRole("button", { name: "更新密码", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await other.goto("/settings/security");
    await expect(other).toHaveURL(/\/login/);
    await page.context().addCookies(beforeChange);
    await page.goto("/settings/security");
    await expect(page).toHaveURL(/\/login/);
    await signInProgrammatically(page, account, { ...scenario, password: "New-Session-Password-7!" }, "/settings/security");
  } finally { await otherContext.close(); }
});

test("provider recovery through the real browser form revokes both prior application sessions", async ({ page, browser, scenario }) => {
  const account = scenario.accounts[0]!;
  const otherContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" });
  const other = await otherContext.newPage();
  try {
    await signInProgrammatically(page, account, scenario, "/settings/security");
    await signInProgrammatically(other, account, scenario, "/settings/security");
    const saved = await page.context().cookies();
    const apiUrl = assertLocalHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "local auth URL");
    const admin = createClient(apiUrl, requireSupabaseSecretKey(process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: account.email, options: { redirectTo: new URL("/reset-password", page.url()).href } });
    if (error) throw new Error("Local recovery link generation failed");
    await page.goto(data.properties.action_link);
    await expect(page).toHaveURL(/\/reset-password/);
    await page.getByLabel("新密码", { exact: true }).fill("Recovered-Session-Password-8!");
    await page.getByLabel("确认新密码", { exact: true }).fill("Recovered-Session-Password-8!");
    await page.getByRole("button", { name: "设置新密码", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await other.goto("/settings/security");
    await expect(other).toHaveURL(/\/login/);
    await page.context().addCookies(saved);
    await page.goto("/settings/security");
    await expect(page).toHaveURL(/\/login/);
    await signInProgrammatically(page, account, { ...scenario, password: "Recovered-Session-Password-8!" }, "/settings/security");
  } finally { await otherContext.close(); }
});
