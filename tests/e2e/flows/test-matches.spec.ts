import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { expect, test, signInProgrammatically } from "../fixtures";

test.use({ scenarioProfile: "stats" });
test("管理员创建测试赛，匿名链接可看且不出现在正式赛程", async ({ page, browser, scenario }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "单一场景内检查桌面和手机宽度。");
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL, "test matches browser"), ssl: false });
  const anonymous = await browser.newContext();
  try {
    const entries = await pool.query<{ id: string; name: string; representative_user_id: string; current_roster_revision_id: string }>("SELECT id,name,representative_user_id,current_roster_revision_id FROM competition_entries WHERE competition_id=$1 ORDER BY name", [scenario.seasonId]);
    await pool.query("UPDATE seasons SET competition_template='custom' WHERE id=$1", [scenario.seasonId]);
    await pool.query("UPDATE competition_entries SET approved_roster_revision_id=current_roster_revision_id WHERE competition_id=$1", [scenario.seasonId]);
    for (const entry of entries.rows) await pool.query("INSERT INTO event_rosters (entry_id,source_roster_revision_id,status,confirmed_at,confirmed_by) VALUES ($1,$2,'confirmed',now(),$3)", [entry.id, entry.current_roster_revision_id, entry.representative_user_id]);
    await signInProgrammatically(page, scenario.accounts.find(a => a.key === "admin")!, scenario, `/admin/${scenario.slug}/test-matches`);
    await expect(page.getByRole("heading", { name: "测试赛", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "队伍 A", exact: true }).click();
    await page.getByRole("option", { name: entries.rows[0].name, exact: true }).click();
    await page.getByRole("combobox", { name: "队伍 B", exact: true }).click();
    await page.getByRole("option", { name: entries.rows[1].name, exact: true }).click();
    await page.getByRole("button", { name: "创建测试赛", exact: true }).click();
    await expect(page.getByRole("heading", { name: "测试赛工作台", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    const matchId = page.url().split("/").at(-1)!;
    const viewer = await anonymous.newPage();
    const path = `/${scenario.slug}/matches/${matchId}`;
    await viewer.goto(new URL(path, page.url()).href);
    await expect(viewer.getByText("测试赛 · 不计入正式赛程与统计", { exact: true })).toBeVisible();
    await expect(viewer.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await viewer.goto(new URL(`/${scenario.slug}/matches`, page.url()).href);
    await expect(viewer.locator(`a[href="${path}"]`)).toHaveCount(0);
    await viewer.goto(new URL(`/admin/${scenario.slug}/test-matches`, page.url()).href);
    await expect(viewer.getByRole("button", { name: "创建测试赛", exact: true })).toHaveCount(0);
  } finally { await anonymous.close(); await pool.end(); }
});
