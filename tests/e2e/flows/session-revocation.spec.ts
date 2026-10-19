import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { expect, signInProgrammatically, test } from "../fixtures";
import { assertLocalDatabaseUrl, assertLocalHttpUrl } from "../../../scripts/db/local-environment";
import { requireSupabaseSecretKey } from "../../../src/lib/runtime/supabase-keys";

test.use({ scenarioProfile: "auth" });

test("logout rejects a saved cookie while another login survives", async ({ page, browser, scenario }) => {
  const account = scenario.accounts[0]!;
  const otherContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" });
  const other = await otherContext.newPage();
  try {
    await Promise.all([
      signInProgrammatically(page, account, scenario, "/settings/security"),
      signInProgrammatically(other, account, scenario, "/settings/security"),
    ]);
    const saved = await page.context().cookies();
    await page.getByRole("button", { name: "账号菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("link", { name: "登录", exact: true }).first()).toBeVisible();
    await page.context().addCookies(saved);
    await page.goto("/settings/security");
    await expect(page).toHaveURL(/\/login/);
    await other.reload();
    await expect(other).toHaveURL(/\/settings\/security$/);
    await expect(other.getByLabel("原密码", { exact: true })).toBeVisible();
  } finally { await otherContext.close(); }
});

test("changing password revokes both prior logins and rejects saved cookies", async ({ page, browser, scenario }) => {
  const account = scenario.accounts[0]!;
  const otherContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" });
  const other = await otherContext.newPage();
  try {
    await Promise.all([
      signInProgrammatically(page, account, scenario, "/settings/security"),
      signInProgrammatically(other, account, scenario, "/settings/security"),
    ]);
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
    await Promise.all([
      signInProgrammatically(page, account, scenario, "/settings/security"),
      signInProgrammatically(other, account, scenario, "/settings/security"),
    ]);
    const saved = await page.context().cookies();
    const apiUrl = assertLocalHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "local auth URL");
    const admin = createClient(apiUrl, requireSupabaseSecretKey(process.env.SUPABASE_SECRET_KEY, process.env.NEXT_PUBLIC_SUPABASE_URL), { auth: { persistSession: false, autoRefreshToken: false } });
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

test.describe("administrator password reconciliation", () => {
  test.use({ scenarioProfile: "layout" });
// One real browser stitching check; lock/concurrency/rollback belong to PG.
test("administrator reconciles the exact pending update and the user can log in again", async ({ page, browser, scenario }) => {
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const player = scenario.accounts.find(account => account.key === "player2")!;
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL, "password reconciliation browser"), ssl: false });
  const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" });
  const userPage = await context.newPage();
  const mutationId = randomUUID();
  try {
    await signInProgrammatically(userPage, player, scenario, "/settings/security");
    // Isolated fixture represents a completed, explicitly rejected provider call.
    // No real password is changed, and the browser must execute the actual owner.
    await pool.query("INSERT INTO application_session_controls(user_id,password_mutation_id) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET password_mutation_id=$2", [player.userId, mutationId]);
    await pool.query("DELETE FROM application_sessions WHERE user_id=$1", [player.userId]);
    await userPage.reload();
    await expect(userPage).toHaveURL(/\/login/);
    await signInProgrammatically(page, admin, scenario, "/admin/users");
    await page.goto(`/admin/users?tab=users&q=${encodeURIComponent(player.email)}`);
    const row = page.getByRole("row").filter({ hasText: player.email });
    await row.getByRole("button", { name: "退出旧登录" }).click();
    await expect(page.getByText(`待核查更新：${mutationId}`)).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByLabel("已核实结果").selectOption("rejected");
    await page.getByLabel("核查来源").selectOption("provider_response_log");
    await page.getByLabel("证据编号").fill("isolated-fixture-rejected");
    await page.getByRole("button", { name: "确认恢复登录" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const control = await pool.query("SELECT password_mutation_id FROM application_session_controls WHERE user_id=$1", [player.userId]);
    expect(control.rows[0].password_mutation_id).toBeNull();
    const audit = await pool.query("SELECT meta FROM audit_logs WHERE actor_id=$1 AND target_id=$2 AND meta->'reconciliation'->>'mutationId'=$3", [admin.userId, player.userId, mutationId]);
    expect(audit.rows).toHaveLength(1);
    await signInProgrammatically(userPage, player, scenario, "/settings/security");
    await expect(userPage.getByLabel("原密码", { exact: true })).toBeVisible();
  } finally {
    await context.close();
    await pool.end();
  }
});

});
