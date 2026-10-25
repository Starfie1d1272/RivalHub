import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { expect, test, signInProgrammatically } from "../fixtures";

test.use({ scenarioProfile: "stats" });

// Protect the actual overview → workbench entry and lifecycle-specific controls.
// Service/DB invariants and unknown-response recovery have separate focused owners.
test("管理员从工作台管理赛前赛中解说，完赛须重开名单，取消不开放", async ({ page, scenario }, testInfo) => {
  test.setTimeout(120_000);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL, "commentary browser"), ssl: false });
  const actor = scenario.accounts.find(a => a.key === "admin")!;
  const other = scenario.accounts.find(a => a.key === "player2")!;
  const matchId = randomUUID();
  const third = randomUUID();
  const thirdName = `Caster third ${scenario.shortKey}`;
  const actorName = `Caster admin ${scenario.shortKey}`;
  const otherName = `Caster peer ${scenario.shortKey}`;
  try {
    await pool.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,$3)", [third, `${third}@local.test`, thirdName]);
    await pool.query("INSERT INTO season_admin_grants (season_id,user_id) VALUES ($1,$2)", [scenario.seasonId, third]);
    await pool.query("UPDATE users SET display_name=$2 WHERE id=$1", [actor.userId, actorName]);
    await pool.query("UPDATE users SET display_name=$2 WHERE id=$1", [other.userId, otherName]);
    const entries = await pool.query<{ id: string }>("SELECT id FROM competition_entries WHERE competition_id=$1 ORDER BY name", [scenario.seasonId]);
    await pool.query("INSERT INTO season_admin_grants (season_id,user_id) VALUES ($1,$2)", [scenario.seasonId, other.userId]);
    await pool.query("INSERT INTO matches (id,season_id,stage,entry_a_id,entry_b_id,format,status) VALUES ($1,$2,'stage1',$3,$4,'bo1','scheduled')", [matchId, scenario.seasonId, entries.rows[0].id, entries.rows[1].id]);
    await signInProgrammatically(page, actor, scenario, `/admin/${scenario.slug}/matches`);
    await page.locator(`a[href^="/admin/${scenario.slug}/matches/${matchId}"]`).first().click();
    const management = page.locator("details").filter({ has: page.locator("summary", { hasText: "解说管理" }) });
    await expect(management).toHaveCount(1);
    await management.locator("summary").click();
    await expect(management.getByText("尚无解说", { exact: true })).toBeVisible();
    await management.getByRole("button", { name: `添加 ${otherName}（无直播间）`, exact: true }).click();
    await expect(management.getByRole("button", { name: `移除 ${otherName}`, exact: true })).toBeVisible();
    await expect(management.getByRole("button", { name: /添加录像|保存录像|确认名单更正|更正解说名单/ })).toHaveCount(0);
    await page.reload();
    await management.locator("summary").click();
    await expect(management.getByRole("button", { name: `移除 ${otherName}`, exact: true })).toBeVisible();

    await pool.query("UPDATE matches SET status='in_progress' WHERE id=$1", [matchId]);
    await page.reload();
    await management.locator("summary").click();
    await management.getByRole("button", { name: `移除 ${otherName}`, exact: true }).click();
    await expect(management.getByText("尚无解说", { exact: true })).toBeVisible();
    await management.getByRole("button", { name: `添加 ${otherName}（无直播间）`, exact: true }).click();
    await expect(management.getByRole("button", { name: `移除 ${otherName}`, exact: true })).toBeVisible();
    await management.getByRole("button", { name: `添加 ${actorName}（无直播间）`, exact: true }).click();
    await expect(management.locator("summary")).toContainText("2/2");
    await expect(management.getByRole("button", { name: /^添加 / })).toHaveCount(0);
    await expect(management.getByRole("button", { name: "取消认领", exact: true })).toHaveCount(0);
    await expect(management.getByText("BP 或比赛已开始，请联系管理员调整解说安排。", { exact: true })).toBeVisible();
    await expect(management.getByRole("button", { name: /添加录像|保存录像|确认名单更正|更正解说名单/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("in-progress-commentary.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await expect(management.getByRole("button", { name: `移除 ${otherName}`, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mobile-commentary.png"), fullPage: true });
    const audit = await pool.query("SELECT action,actor_id,meta->>'commentatorUserId' AS target FROM audit_logs WHERE target_id=$1 AND action IN ('postmatch.commentator.add','postmatch.commentator.remove')", [matchId]);
    expect(audit.rows).toContainEqual({ action: "postmatch.commentator.remove", actor_id: actor.userId, target: other.userId });

    await pool.query("UPDATE matches SET status='finished',score_a=1,score_b=0,completed_at=now() WHERE id=$1", [matchId]);
    await page.reload();
    await expect(management).toHaveCount(0);
    const postmatch = page.locator("details#match-workbench-finished-postmatch");
    await expect(postmatch.locator("summary")).toHaveText("解说与录像");
    if (!(await postmatch.evaluate(element => element.hasAttribute("open")))) await postmatch.locator("summary").click();
    await expect(postmatch.getByRole("button", { name: /^移除 / })).toHaveCount(0);
    await expect(postmatch.getByRole("button", { name: "添加录像", exact: true })).toHaveCount(2);
    await postmatch.getByRole("button", { name: "更正解说名单", exact: true }).click();
    await postmatch.getByRole("button", { name: "重开名单", exact: true }).click();
    await expect(postmatch.getByRole("button", { name: `移除 ${otherName}`, exact: true })).toBeVisible();
    await postmatch.getByRole("button", { name: `移除 ${actorName}`, exact: true }).click();
    await expect(postmatch.getByRole("button", { name: `移除 ${actorName}`, exact: true })).toHaveCount(0);
    await expect(postmatch.getByRole("button", { name: "确认名单更正", exact: true })).toBeEnabled();
    await postmatch.getByRole("button", { name: "确认名单更正", exact: true }).click();
    await expect(postmatch.getByRole("button", { name: /^移除 / })).toHaveCount(0);
    await expect(postmatch.getByRole("button", { name: "更正解说名单", exact: true })).toBeVisible();

    await page.reload();
    if (!(await postmatch.evaluate(element => element.hasAttribute("open")))) await postmatch.locator("summary").click();
    await postmatch.getByRole("button", { name: "更正解说名单", exact: true }).click();
    await postmatch.getByRole("button", { name: "重开名单", exact: true }).click();
    await postmatch.getByRole("button", { name: `添加 ${thirdName}（无直播间）`, exact: true }).click();
    await expect(postmatch.getByRole("button", { name: `移除 ${thirdName}`, exact: true })).toBeVisible();
    // The super-admin was absent from both names before changing two other casters to one.
    await postmatch.getByRole("button", { name: `移除 ${thirdName}`, exact: true }).click();
    await expect(postmatch.getByRole("button", { name: `移除 ${thirdName}`, exact: true })).toHaveCount(0);
    await expect(postmatch.getByRole("button", { name: "确认名单更正", exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("super-admin-one-caster-correction.png"), fullPage: true });
    await postmatch.getByRole("button", { name: "确认名单更正", exact: true }).click();
    await expect(postmatch.getByRole("button", { name: "更正解说名单", exact: true })).toBeVisible();
    expect((await pool.query("SELECT submitted_by_user_id FROM post_match_reports WHERE match_id=$1", [matchId])).rows).toEqual([{ submitted_by_user_id: actor.userId }]);
    expect((await pool.query("SELECT user_id FROM match_commentators WHERE match_id=$1", [matchId])).rows).toEqual([{ user_id: other.userId }]);
    expect((await pool.query("SELECT actor_id FROM audit_logs WHERE target_id=$1 AND action='postmatch.report.submit'", [matchId])).rows).toEqual([{ actor_id: actor.userId }, { actor_id: actor.userId }]);
    await page.screenshot({ path: testInfo.outputPath("super-admin-correction-confirmed.png"), fullPage: true });

    await pool.query("UPDATE matches SET status='cancelled' WHERE id=$1", [matchId]);
    await page.reload();
    await expect(management).toHaveCount(0);
    await expect(postmatch).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^添加 |^移除 |更正解说名单|确认名单更正/ })).toHaveCount(0);
  } finally {
    await pool.query("DELETE FROM season_admin_grants WHERE user_id=$1", [third]).catch(() => undefined);
    await pool.query("DELETE FROM users WHERE id=$1", [third]).catch(() => undefined);
    await pool.end();
  }
});
