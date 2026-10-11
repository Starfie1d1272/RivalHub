import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { parseRivalHubDemoEvidenceV1 } from "../../../src/lib/demo-evidence/contract";
import { test, expect, signInProgrammatically } from "../fixtures";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
test.use({ scenarioProfile: "stats" });
// A real browser is needed to catch intrinsic table sizing, viewport overflow and
// focus/scroll regressions that component rendering tests cannot measure.
test("真实后台审计与赛后资料在窄屏保留可读内容和操作", async ({ page, scenario }, testInfo) => {
  const output = process.env.RIVALHUB_VISUAL_OUTPUT ?? testInfo.outputPath("visual-review");
  test.setTimeout(240_000);
  mkdirSync(output, { recursive: true });
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL, "visual fixture"), ssl: false });
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const pairing = randomUUID(), intent = randomUUID(), audit = randomUUID(), missingAudit = randomUUID();
  const measurements: unknown[] = [];
  try {
    const { rows: [match] } = await pool.query("SELECT id, entry_a_id, entry_b_id FROM matches WHERE season_id=$1", [scenario.seasonId]);
    const { rows: [map] } = await pool.query("UPDATE match_maps SET map_name='de_ancient',score_a=13,score_b=6,completed_at=now() WHERE match_id=$1 RETURNING id", [match.id]);
    await pool.query("UPDATE matches SET completed_at=now() WHERE id=$1", [match.id]);
    await pool.query("UPDATE competition_entries SET name=$2 WHERE id=$1", [match.entry_a_id, "AuroraChampionshipTeam".repeat(5)]);
    await pool.query("INSERT INTO match_commentators (match_id,user_id,added_by_user_id) VALUES ($1,$2,$2)", [match.id, admin.userId]);
    await pool.query("INSERT INTO post_match_reports (match_id,submitted_by_user_id) VALUES ($1,$2)", [match.id, admin.userId]);
    const meta = { submittedByUserId: admin.userId, originalSubmittedAt: new Date().toISOString(), before: { submitted: true, hasVideoUrl: false }, after: { submitted: false, hasVideoUrl: false }, reason: "核对录像与解说名单后重新整理。本条是本地测试资料，用于检查长说明的换行及滚动。".repeat(12).slice(0,500) };
    for (const id of [audit, missingAudit]) await pool.query("INSERT INTO audit_logs (id,season_id,actor_id,action,target_type,target_id,meta) VALUES ($1,$2,$3,'postmatch.report.revoke','match',$4,$5::jsonb)", [id,scenario.seasonId,admin.userId,match.id,JSON.stringify(meta)]);
    await pool.query("INSERT INTO dak_pairing_intents (id,poll_token_hash,expires_at,status,authorized_by_user_id,authorized_at) VALUES ($1,$2,now()+interval '1 day','authorized',$3,now())", [intent, randomUUID(), admin.userId]);
    await pool.query("INSERT INTO dak_pairings (id,pairing_intent_id,user_id,token_hash,scopes,season_ids) VALUES ($1,$2,$3,$4,ARRAY['demo:submit'],ARRAY[$5::text])", [pairing,intent,admin.userId,randomUUID(),scenario.seasonId]);
    const evidence = JSON.parse(readFileSync("tests/fixtures/demo-evidence/normal-map-v1.json", "utf8"));
    for (const participant of evidence.participants) if (participant.resolution.status === "matched") participant.resolution.entryId = participant.resolution.entryId === evidence.target.entryAId ? match.entry_a_id : match.entry_b_id;
    Object.assign(evidence.target, { seasonId: scenario.seasonId, matchId: match.id, matchMapId: map.id, entryAId: match.entry_a_id, entryBId: match.entry_b_id });
    evidence.quality.qa = { ok: true, issueCount: 3, errorCount: 0, warningCount: 3 };
    evidence.extensions["cs2dak/diagnostics"] = { version: 1, qa: { omittedIssueCount: 0, issues: [
      { severity: "warning", code: "rounds.coverage.incomplete.rounds.coverage.incomplete.rounds.coverage.incomplete", path: "sourceFacts.rounds[12].players[9].equipment.items[12].extendedFields.availableInformation", message: "数据覆盖说明：" + "需要结合已确认比分核对逐回合数据，扩展信息缺失不代表整份上传失败。".repeat(9) },
      { severity: "warning", code: "combat.flags.missing", path: "sourceFacts.kills[32].flags", message: "ExtendedFieldCoverage".repeat(15).split(/(.{30})/).filter(Boolean).join(".").slice(0,310) },
      { severity: "warning", code: "economy.items.incomplete", path: "sourceFacts.rounds[12].teamA", message: "部分经济信息不可用，请按实际可用数据核对。" },
    ] }, richKills: { eventCount: evidence.sourceFacts.kills.length, flagsEventCount: 1, namedActiveWeaponEventCount: 0, reason: "no_named_active_weapon" } };
    const parsed = parseRivalHubDemoEvidenceV1(evidence);
    const hash = createHash("sha256").update(JSON.stringify(stable(parsed))).digest("hex");
    await pool.query("INSERT INTO match_demo_imports (season_id,match_id,match_map_id,stage_key,demo_sha256,payload_sha256,contract_version,semantic_profile,analysis_version,evidence_revision,status,payload,submitted_by_pairing_id,confirmed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed',$11::jsonb,$12,now())", [scenario.seasonId,match.id,map.id,parsed.target.stageKey,parsed.source.demoSha256,hash,parsed.contract.contractVersion,parsed.contract.semanticProfile,parsed.contract.analysisVersion,parsed.target.evidenceRevision,JSON.stringify(parsed),pairing]);
    await signInProgrammatically(page,admin,scenario,`/admin/${scenario.slug}/logs`);
    for (const width of [1440,390,320]) {
      await page.setViewportSize({ width, height: width===1440 ? 1000 : 844 });
      await page.goto(`/admin/${scenario.slug}/logs`);
      const trigger = page.getByRole("button", { name: /查看.*赛后.*详情/ }).first();
      await expect(trigger).toBeVisible();
      const badge = page.getByRole("button", {name:"Collapse issues badge", includeHidden:true});
      if (await badge.count()) await badge.dispatchEvent("click");
      expect(await trigger.locator("xpath=ancestor::td").evaluate(el=>el.clientWidth)).toBeGreaterThanOrEqual(150);
      await page.screenshot({ animations: "disabled", path: `${output}/audit-table-${width}.png`, fullPage: true });
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("原提交时间", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("status")).toHaveCount(0);
      if(await badge.count()) await badge.dispatchEvent("click");
      await page.screenshot({ animations: "disabled", path: `${output}/audit-detail-${width}.png` });
      measurements.push({ scenario: `audit-${width}`, ...await dialog.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, body: [...el.querySelectorAll("div")].filter(x=>getComputedStyle(x).overflowY==='auto').map(x=>({client:x.clientWidth,scroll:x.scrollWidth,height:x.clientHeight,scrollHeight:x.scrollHeight})) })) });
      await dialog.locator("div.overflow-y-auto").evaluate(el=>el.scrollTop=el.scrollHeight);
      await expect(dialog.getByRole("link",{name:"打开比赛工作台"})).toBeVisible();
      await page.screenshot({ animations: "disabled", path: `${output}/audit-scrolled-${width}.png` });
      await expect(dialog.getByRole("link",{name:"打开比赛工作台"})).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      writeFileSync(`${output}/measurements.json`,JSON.stringify(measurements,null,2));
      await page.goto(`/admin/${scenario.slug}/matches/${match.id}`);
      const revoke = page.getByRole("button", { name:"撤销提交 / 重新开放整理" });
      await expect(revoke).toBeVisible();
      await revoke.click();
      await page.getByLabel("撤销原因（选填）").fill(meta.reason);
      await page.getByRole("button",{name:"撤销提交",exact:true}).scrollIntoViewIfNeeded();
      if (width < 600) {
        const explanation = await page.getByText("撤销提交并重新开放整理？", { exact: true }).locator("..").boundingBox();
        const confirm = await page.getByRole("button", { name: "撤销提交", exact: true }).boundingBox();
        expect(explanation).not.toBeNull();
        expect(confirm).not.toBeNull();
        expect(confirm!.y).toBeGreaterThanOrEqual(explanation!.y + explanation!.height);
      }
      const postmatch = revoke.locator("xpath=ancestor::section[1]");
      await postmatch.evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-80}));
      await postmatch.screenshot({ animations: "disabled",path:`${output}/postmatch-revoke-${width}.png`});
      await page.getByRole("button",{name:"取消",exact:true}).click();
      const qa = page.locator("details").filter({has:page.locator("summary",{hasText:/第 1 图.*QA 检查/})}).first();
      await qa.scrollIntoViewIfNeeded();
      await page.screenshot({ animations: "disabled",path:`${output}/demo-quality-collapsed-${width}.png`});
      await qa.locator(":scope > summary").click();
      await qa.getByText("QA 技术详情（3 条）",{exact:true}).click();
      await qa.scrollIntoViewIfNeeded();
      await qa.evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-80}));
      await page.screenshot({path:`${output}/demo-quality-expanded-${width}.png`,animations:"disabled"});
      if(width < 600) {
        await qa.locator("li").last().scrollIntoViewIfNeeded();
        await page.screenshot({path:`${output}/demo-quality-bottom-${width}.png`,animations:"disabled"});
      }
      expect(await qa.evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(await qa.evaluate(el=>el.clientWidth));
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      measurements.push({scenario:`workbench-${width}`, ...await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth, overflowing:[...document.querySelectorAll("main *")].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>({tag:el.tagName,text:el.textContent?.slice(0,80),width:el.getBoundingClientRect().width}))}))});
    }
    await page.setViewportSize({width:390,height:844});
    await page.goto(`/admin/${scenario.slug}/logs`);

    // Local-only response fixture exercises the actual Dialog failure rendering;
    // the successful server read remains read-only and no production data is used.
    await page.route("**/*",async route=>{
      if(route.request().method()==="POST" && route.request().headers()["next-action"] && [audit,missingAudit].some(id=>route.request().postData()?.includes(id))){
        const response=await route.fetch();
        const body=(await response.text()).split("\n").map(line => line.includes('"success":true') ? line.replace(/^(\w+):.*$/, (_, id: string) => `${id}:${JSON.stringify({success:false,error:{code:"INTERNAL_ERROR",message:"日志详情加载失败。" + "请刷新页面并确认赛事范围，若仍有问题请联系管理员核对。".repeat(12)}})}`) : line).join("\n");
        await route.fulfill({response,body});
      }else await route.continue();
    });
    const errorTrigger=page.getByRole("button",{name:/查看.*赛后.*详情/}).first();
    await expect(errorTrigger).toBeVisible();
    const badge=page.getByRole("button",{name:"Collapse issues badge",includeHidden:true});
    if(await badge.count()) await badge.dispatchEvent("click");
    await errorTrigger.click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("status")).toHaveCount(0);
    if(await badge.count()) await badge.dispatchEvent("click");
    await page.screenshot({ animations: "disabled",path:`${output}/audit-error-390.png`});
    const errorDialog=page.getByRole("dialog");
    expect(await errorDialog.evaluate(el=>el.scrollWidth)).toBe(await errorDialog.evaluate(el=>el.clientWidth));
    await page.getByRole("button",{name:"Close",exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    writeFileSync(`${output}/measurements.json`,JSON.stringify(measurements,null,2));
  } finally {
    await pool.query("DELETE FROM match_demo_imports WHERE season_id=$1",[scenario.seasonId]);
    await pool.query("DELETE FROM dak_pairings WHERE id=$1",[pairing]);
    await pool.query("DELETE FROM dak_pairing_intents WHERE id=$1",[intent]);
    await pool.end();
  }
});
