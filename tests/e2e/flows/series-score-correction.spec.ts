import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { expect, test, signInProgrammatically } from "../fixtures";

test.use({ scenarioProfile: "stats" });
test("管理员核对过期预览后完成系列更正，未打地图没有赛后待办", async ({ page, scenario }) => {
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL, "browser fixture"), ssl: false });
  const end = new Date("2026-10-01T12:30:00Z");
  try {
    const { rows: [match] } = await pool.query<{ id: string; entry_a_id: string; entry_b_id: string }>("SELECT id, entry_a_id, entry_b_id FROM matches WHERE season_id = $1", [scenario.seasonId]);
    if (!match) throw new Error("Browser scenario missing its match");
    await pool.query("UPDATE matches SET format = 'bo3', status = 'in_progress', score_a = NULL, score_b = NULL, started_at = $2, completed_at = NULL WHERE id = $1", [match.id, new Date(end.getTime() - 5400000)]);
    await pool.query("UPDATE match_maps SET map_name = 'de_ancient', score_a = 13, score_b = 9, completed_at = $2 WHERE match_id = $1", [match.id, new Date(end.getTime() - 3600000)]);
    const { rows: [map] } = await pool.query<{ id: string }>("INSERT INTO match_maps (match_id, map_order, map_name, score_a, score_b, completed_at) VALUES ($1,2,'de_mirage',9,13,$2) RETURNING id", [match.id, end]);
    await pool.query("INSERT INTO match_maps (match_id,map_order,map_name) VALUES ($1,3,'de_nuke')", [match.id]);
    await pool.query("INSERT INTO match_veto_sessions (match_id,started_at,completed_at) VALUES ($1,$2,$2) ON CONFLICT (match_id) DO UPDATE SET completed_at = $2", [match.id, new Date(end.getTime() - 5400000)]);
    const names = await pool.query<{ id: string; name: string }>("SELECT id,name FROM competition_entries WHERE id IN ($1,$2)", [match.entry_a_id, match.entry_b_id]);
    const teamA = names.rows.find(row => row.id === match.entry_a_id)!.name;
    const teamB = names.rows.find(row => row.id === match.entry_b_id)!.name;
    const admin = scenario.accounts.find(account => account.key === "admin")!;
    await signInProgrammatically(page, admin, scenario, `/admin/${scenario.slug}/matches/${match.id}`);
    const correction = page.getByLabel("比分更正与系列恢复", { exact: true });
    await correction.locator("summary").click();
    await correction.getByRole("button", { name: "更正比分", exact: true }).nth(1).click();
    await correction.getByLabel(`${teamA}更正比分`).fill("13"); await correction.getByLabel(`${teamB}更正比分`).fill("9");
    await correction.getByLabel("更正原因", { exact: true }).fill("核对 Perfect 实际比分");
    const preview = async () => {
      await correction.getByRole("button", { name: "核对更正", exact: true }).click();
      await correction.getByRole("button", { name: "进入系列赛果更正" }).click();
    };
    await preview();
    const review = page.getByRole("region", { name: "更正系列赛果", exact: true });
    await expect(review.getByText(`当前：${teamA} 1 : 1 ${teamB}`, { exact: true })).toBeVisible();
    await expect(review.getByText(`更正后：${teamA} 2 : 0 ${teamB}`, { exact: true })).toBeVisible();
    await expect(review.getByText("Map 3：未进行，更正后不再需要", { exact: true })).toBeVisible();
    const confirm = review.getByRole("button", { name: "确认更正系列赛果", exact: true });
    await expect(confirm).toBeDisabled(); await expect(review.getByLabel("整场更正原因")).toHaveValue("核对 Perfect 实际比分");
    await review.getByRole("checkbox").check();
    await pool.query("UPDATE match_maps SET score_a = 10 WHERE id = $1", [map!.id]);
    await confirm.click(); await expect(review.getByRole("alert")).toContainText("正式比分已更新");
    expect((await pool.query("SELECT status FROM matches WHERE id = $1", [match.id])).rows[0].status).toBe("in_progress");
    await pool.query("UPDATE match_maps SET score_a = 9 WHERE id = $1", [map!.id]);
    await review.getByRole("button", { name: "返回重新核对" }).click(); await preview();
    await expect(review.getByLabel("整场更正原因")).toHaveValue("核对 Perfect 实际比分"); await review.getByRole("checkbox").check();
    await confirm.click(); await expect(review).toHaveCount(0);
    const persisted = (await pool.query("SELECT status,score_a,score_b,completed_at FROM matches WHERE id = $1", [match.id])).rows[0];
    expect(persisted).toMatchObject({ status: "finished", score_a: 2, score_b: 0, completed_at: end });
    await page.reload(); await expect(page.getByRole("region", { name: "赛后完成度" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /准备 Map 3/ })).toHaveCount(0);
    await expect(page.getByRole("group").filter({ hasText: /^Map 3/ })).toHaveCount(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE target_id = $1 AND action = 'match.series.corrected'", [match.id])).rows[0].count).toBe(1);
  } finally {
    await pool.query("DELETE FROM match_veto_sessions WHERE match_id IN (SELECT id FROM matches WHERE season_id = $1)", [scenario.seasonId]);
    await pool.end();
  }
});
