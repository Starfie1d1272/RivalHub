import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { test, expect, signInProgrammatically } from "../fixtures";

test.use({ scenarioProfile: "layout" });
test("管理员在桌面与移动端识别自主名单草稿及截止状态", async ({ page, scenario }) => {
  test.setTimeout(120000);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const client = await pool.connect();
  const entryId = randomUUID(), approvedId = randomUUID(), draftId = randomUUID();
  const owner = scenario.accounts.find(account => account.key === "player2")!;
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, approved_roster_revision_id, registration_status) VALUES ($1,$2,'event_native','浏览器名单草稿',$3,$4,$5,'changes_requested')`, [entryId, scenario.seasonId, owner.userId, draftId, approvedId]);
    await client.query(`INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, origin, created_by) VALUES ($1,$3,1,'approved','initial',$4), ($2,$3,2,'draft','self_roster_change',$4)`, [approvedId, draftId, entryId, admin.userId]);
    await client.query(`INSERT INTO competition_entry_representative_changes (entry_id,to_user_id,changed_by_actor_id) VALUES ($1,$2,$3)`, [entryId, owner.userId, admin.userId]);
    await client.query("COMMIT");
    await signInProgrammatically(page, admin, scenario, `/admin/${scenario.slug}/registrations`);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`/admin/${scenario.slug}/registrations`);
      await expect(page.getByRole("heading", { name: "浏览器名单草稿" })).toBeVisible();
      await expect(page.getByText("草稿待提交", { exact: true }).last()).toBeVisible();
      await expect(page.getByText(/下一步：负责人.*提交新版名单/)).toBeVisible();
      await expect(page.getByText(/名单调整截止/)).toBeVisible();
      await expect(page.getByRole("button", { name: "批准", exact: true })).toHaveCount(0);
      await page.getByRole("combobox", { name: "队伍报名状态" }).selectOption("self_change_draft");
      await expect(page).toHaveURL(/status=self_change_draft/);
      await expect(page.getByRole("heading", { name: "浏览器名单草稿" })).toBeVisible();
      await page.getByRole("combobox", { name: "队伍报名状态" }).selectOption("changes_requested");
      await expect(page.getByRole("heading", { name: "浏览器名单草稿" })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await client.query("UPDATE seasons SET roster_change_closes_at = now() - interval '1 minute' WHERE id=$1", [scenario.seasonId]);
    await page.goto(`/admin/${scenario.slug}/registrations`);
    await expect(page.getByText(/名单调整已截止 · 须联系赛委会/)).toBeVisible();
    await expect(page.getByText(/下一步：负责人.*提交新版名单/)).toHaveCount(0);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});
