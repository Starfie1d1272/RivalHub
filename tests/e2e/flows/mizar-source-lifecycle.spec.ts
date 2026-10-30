import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { expect, test, signInProgrammatically } from "../fixtures";

test.use({ scenarioProfile: "stats" });
test("管理员核对来源并逐条处理批量变化", async ({ page, scenario }) => {
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL, "browser fixture"), ssl: false });
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const installation = randomUUID(), pairing = randomUUID(), extraMatch = randomUUID(), first = randomUUID(), second = randomUUID();
  let originalMatch = "";
  try {
    const { rows: [match] } = await pool.query<{ id: string; entry_a_id: string; entry_b_id: string }>("SELECT id,entry_a_id,entry_b_id FROM matches WHERE season_id=$1 LIMIT 1", [scenario.seasonId]);
    if (!match) throw new Error("Missing match fixture");
    originalMatch = match.id;
    const old = new Date(Date.now() - 3_600_000);
    await pool.query("UPDATE matches SET status='finished',format='bo3',score_a=2,score_b=0,completed_at=$2 WHERE id=$1", [match.id, old]);
    await pool.query("INSERT INTO matches(id,season_id,entry_a_id,entry_b_id,stage,format,status,score_a,score_b,completed_at) VALUES($1,$2,$3,$4,'fixture','bo3','finished',2,0,$5)", [extraMatch, scenario.seasonId, match.entry_a_id, match.entry_b_id, old]);
    await pool.query("INSERT INTO mizar_pairing_intents(id,poll_token_hash,status,competition_id,authorized_by_user_id,expires_at,authorized_at) VALUES($1,$2,'authorized',$3,$4,now()+interval '1 hour',now())", [pairing, randomUUID(), scenario.seasonId, admin.userId]);
    await pool.query("INSERT INTO mizar_installations(id,competition_id,pairing_intent_id,authorized_by_user_id,credential_hash) VALUES($1,$2,$3,$4,$5)", [installation, scenario.seasonId, pairing, admin.userId, randomUUID()]);
    for (const [id, matchId] of [[first, match.id], [second, extraMatch]]) await pool.query("INSERT INTO match_live_sessions(id,match_id,installation_id,producer_instance_id,live_session_id,context_revision,authority_revision,program_source_generation,map_epoch,opened_at) VALUES($1,$2,$3,'browser-producer','browser-live','browser-context',1,0,0,$4)", [id, matchId, installation, old]);
    await signInProgrammatically(page, admin, scenario, `/admin/${scenario.slug}/matches`);
    await page.getByRole("button", { name: "设备与下载" }).click();
    await page.getByRole("button", { name: "查看来源会话" }).click();
    const dialog = page.getByRole("dialog");
    const row1 = dialog.locator("article").filter({ hasText: first });
    const row2 = dialog.locator("article").filter({ hasText: second });
    await expect(row1).toContainText("已完赛，来源未释放");
    await expect(dialog).toContainText("当前接收状态未知");
    await row1.getByRole("checkbox").check(); await row2.getByRole("checkbox").check();
    await pool.query("INSERT INTO mizar_reliable_receipts(session_id,idempotency_key,event_hash,kind,outcome) VALUES($1,$2,'synthetic','map_player_snapshot','observed')", [second, randomUUID()]);
    await dialog.getByRole("button", { name: "关闭所选 2 条" }).click();
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText(`${first}: 已关闭`);
    await expect(dialog.getByRole("status")).toContainText(`${second}: 状态已变化`);
    const result = await pool.query("SELECT id,close_reason FROM match_live_sessions WHERE id=ANY($1::uuid[])", [[first, second]]);
    expect(result.rows.find(row => row.id === first).close_reason).toBe("admin_completed_cleanup");
    expect(result.rows.find(row => row.id === second).close_reason).toBeNull();
  } finally {
    await pool.query("DELETE FROM audit_logs WHERE action='mizar.source.admin_cleanup' AND target_id=ANY($1::text[])", [[originalMatch, extraMatch]]);
    await pool.query("DELETE FROM mizar_reliable_receipts WHERE session_id=ANY($1::uuid[])", [[first, second]]);
    await pool.query("DELETE FROM match_live_sessions WHERE id=ANY($1::uuid[])", [[first, second]]);
    await pool.query("DELETE FROM mizar_installations WHERE id=$1", [installation]);
    await pool.query("DELETE FROM mizar_pairing_intents WHERE id=$1", [pairing]);
    await pool.query("DELETE FROM matches WHERE id=$1", [extraMatch]);
    await pool.end();
  }
});
