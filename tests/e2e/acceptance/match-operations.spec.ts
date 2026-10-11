import { mkdirSync } from "node:fs";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { test, expect, signInProgrammatically } from "../fixtures";

test.use({ scenarioProfile: "stats" });
test("BP 完成后角色入口与恢复原因在窄屏可发现", async ({ page, scenario }, testInfo) => {
  test.setTimeout(180_000);
  const output = process.env.RIVALHUB_VISUAL_OUTPUT ?? testInfo.outputPath("visual-review");
  mkdirSync(output, { recursive: true });
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL, "operations browser fixture"), ssl: false });
  try {
    const { rows: [match] } = await pool.query("SELECT id FROM matches WHERE season_id=$1", [scenario.seasonId]);
    await pool.query("UPDATE matches SET status='in_progress',score_a=NULL,score_b=NULL,started_at=now() WHERE id=$1", [match.id]);
    await pool.query("INSERT INTO match_veto_sessions (match_id,started_at,completed_at,map_pool_snapshot) VALUES ($1,now(),now(),'[\"de_vertigo\",\"de_train\",\"de_mirage\",\"de_inferno\",\"de_nuke\",\"de_ancient\",\"de_anubis\"]')", [match.id]);
    const path = `/${scenario.slug}/matches/${match.id}`;
    const hideDevTools = async () => { await page.locator("nextjs-portal").evaluateAll(elements => elements.forEach(el => (el as HTMLElement).style.display = "none")); };
    const admin = scenario.accounts.find(account => account.key === "admin")!;
    const captain = scenario.accounts.find(account => account.key === "player2")!;
    await signInProgrammatically(page, admin, scenario, path);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.getByRole("link", { name: "进入 BP 房间", exact: true })).toBeVisible();
      await page.screenshot({ path: `${output}/bp-admin-entry-${width}.png`, fullPage: true });
      await page.getByRole("link", { name: "进入 BP 房间", exact: true }).click();
      await expect(page).toHaveURL(`${path}/veto`);
      const reason = page.getByLabel("恢复原因", { exact: true });
      await reason.scrollIntoViewIfNeeded();
      await expect(reason).toHaveAttribute("aria-describedby", "veto-rewind-reason-help");
      await reason.fill(" a ");
      await expect(page.getByRole("button", { name: "恢复 BP 步骤", exact: true })).toBeDisabled();
      await reason.fill("队长重新确认");
      await page.getByRole("button", { name: "恢复 BP 步骤", exact: true }).click();
      await expect(page.getByRole("button", { name: "确认恢复", exact: true })).toBeVisible();
      await page.screenshot({ path: `${output}/bp-admin-recovery-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await pool.query("UPDATE match_veto_sessions SET completed_at=NULL,current_turn_key='choose-veto-team-a',paused_at=now(),paused_by=$2,pause_reason='本地恢复核对' WHERE match_id=$1", [match.id, admin.userId]);
    await page.reload();
    await expect(page.getByRole("button", { name: "继续 BP", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "继续 BP", exact: true }).scrollIntoViewIfNeeded();
    await hideDevTools();
    await page.screenshot({ path: `${output}/bp-paused-continue-390.png`, fullPage: true });
    await pool.query("UPDATE match_veto_sessions SET completed_at=now(),paused_at=NULL,paused_by=NULL,pause_reason=NULL,current_turn_key=NULL WHERE match_id=$1", [match.id]);
    await page.context().clearCookies();
    await signInProgrammatically(page, captain, scenario, path);
    await page.goto(path);
    await page.getByRole("link", { name: "进入 BP 房间", exact: true }).click();
    await expect(page.getByRole("button", { name: "更新 BP 信息", exact: true })).toBeVisible();
    await expect(page.getByLabel("恢复原因", { exact: true })).toHaveCount(0);
    await hideDevTools();
    await page.screenshot({ path: `${output}/bp-captain-permission-390.png`, fullPage: true });
    await page.context().clearCookies();
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "比赛数据", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "进入 BP 房间", exact: true })).toHaveCount(0);
    await hideDevTools();
    await page.screenshot({ path: `${output}/bp-anonymous-permission-390.png`, fullPage: true });
  } finally { await pool.end(); }
});
