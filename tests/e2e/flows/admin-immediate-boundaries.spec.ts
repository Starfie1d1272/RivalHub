import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { test as base, expect, signInProgrammatically } from "../fixtures";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";

// pg_stat_statements aggregates normalized SQL for the whole database. Keep
// this spec's desktop/mobile probes and frozen-fixture navigation independent.
// A connection-owned local advisory lock releases even if a worker exits.
const test = base.extend<{ adminEvidenceIsolation: void }>({
  adminEvidenceIsolation: [async ({ scenarioProfile }, applyEvidence) => {
    void scenarioProfile;
    const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
    const client = await pool.connect();
    try {
      await client.query("select pg_advisory_lock($1,$2)", [1112, 20261024]);
      await applyEvidence();
    } finally {
      await client.query("select pg_advisory_unlock($1,$2)", [1112, 20261024]);
      client.release();
      await pool.end();
    }
  }, { auto: true }],
});

test.use({ scenarioProfile: "layout", trace: "on" });
test.setTimeout(180_000);

test("目录实际RSC去重与撤权新请求；审计直接URL和back-forward保持50行标签", async ({ page, scenario }) => {
  const actor = scenario.accounts.find(account => account.key === "player2")!;
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const fixture = await createPredictionBrowserFixture(actor.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const matchIds = Array.from({ length: 20 }, () => randomUUID());
  const mapIds = Array.from({ length: 10 }, () => randomUUID());
  const logIds = Array.from({ length: 65 }, () => randomUUID());
  try {
    await pool.query("insert into season_admin_grants(season_id,user_id) values($1,$2)", [fixture.seasonId, actor.userId]);
    await signInProgrammatically(page, actor, scenario, "/account");
    await page.goto("about:blank");
    const extension = await pool.query<{ schema: string }>("select n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_stat_statements'");
    const namespace = extension.rows[0]?.schema;
    if (!namespace || !/^[a-z_]+$/.test(namespace)) throw new Error("本地pg_stat_statements不可读，不能声称真实RSC SQL去重通过");
    async function calls(pattern: string) {
      const result = await pool.query<{ calls: string }>(`select coalesce(sum(calls),0)::text as calls from "${namespace}".pg_stat_statements where dbid=(select oid from pg_database where datname=current_database()) and query like $1`, [pattern]);
      return BigInt(result.rows[0]!.calls);
    }
    const directoryPattern = '%"has_community_awards"%from "seasons"%order by "seasons"."created_at" desc%';
    const before = await calls(directoryPattern);
    const rootResponse = await page.request.get("/admin", { headers: { RSC: "1" } });
    expect(rootResponse.ok()).toBe(true);
    expect(rootResponse.headers()["content-type"]).toContain("text/x-component");
    const flight = await rootResponse.text();
    expect(flight).toContain(fixture.slug);
    const directoryReads = Number(await calls(directoryPattern) - before);
    expect(directoryReads).toBe(1);
    await pool.query("delete from season_admin_grants where season_id=$1 and user_id=$2", [fixture.seasonId, actor.userId]);
    await page.goto("/admin");
    await expect(page.getByRole("alert").filter({ hasText: "FORBIDDEN" })).toContainText("没有访问此管理页面所需的权限");

    const source = (await pool.query<{ entry_a_id: string; entry_b_id: string }>("select entry_a_id,entry_b_id from matches where season_id=$1 limit 1", [fixture.seasonId])).rows[0]!;
    for (const id of matchIds) await pool.query("insert into matches(id,season_id,entry_a_id,entry_b_id,stage,format) values($1,$2,$3,$4,'stage1','bo1')", [id, fixture.seasonId, source.entry_a_id, source.entry_b_id]);
    for (let i = 0; i < mapIds.length; i++) await pool.query("insert into match_maps(id,match_id,map_order,map_name) values($1,$2,1,'de_nuke')", [mapIds[i], matchIds[i]]);
    const targets = [...matchIds.map(id => ({ type: "match", id })), ...mapIds.map(id => ({ type: "match_map", id }))];
    for (let i = 0; i < logIds.length; i++) {
      const target = targets[i % targets.length]!;
      await pool.query("insert into audit_logs(id,season_id,action,actor_id,target_type,target_id,created_at) values($1,$2,'fixture.audit.view',$3,$4,$5,'2051-01-01'::timestamptz+$6*interval '1 second')", [logIds[i], fixture.seasonId, admin.userId, target.type, target.id, i]);
    }
    await signInProgrammatically(page, admin, scenario, "/admin/logs");
    await page.goto(`/admin/logs?seasonId=${fixture.seasonId}&page=999`);
    await expect(page.locator("tbody tr")).toHaveCount(15);
    await expect(page.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
    await expect(page.getByRole("navigation", { name: "列表分页" })).toContainText("第 2 / 2 页");
    await page.goto(`/admin/logs?seasonId=${fixture.seasonId}&page=2`);
    await expect(page.locator("tbody tr")).toHaveCount(15);
    await page.goto(`/admin/logs?seasonId=${fixture.seasonId}`);
    await expect(page.locator("tbody tr")).toHaveCount(50);
    const entry = await pool.query<{ name: string }>("select name from competition_entries where id=$1", [source.entry_a_id]);
    const labels = await page.locator("tbody tr td:nth-child(4)").allTextContents();
    expect(labels).toHaveLength(50);
    for (const label of labels) expect(label).toContain(entry.rows[0]!.name);
    await page.goto("about:blank");
    const labelBefore = await calls('%"entry_a_id", "entry_b_id", "execution_context" from "matches"%');
    const auditResponse = await page.request.get(`/admin/logs?seasonId=${fixture.seasonId}`, { headers: { RSC: "1" } });
    expect(auditResponse.ok()).toBe(true);
    expect(auditResponse.headers()["content-type"]).toContain("text/x-component");
    await auditResponse.text();
    const matchLabelReads = Number(await calls('%"entry_a_id", "entry_b_id", "execution_context" from "matches"%') - labelBefore);
    expect(matchLabelReads).toBe(1);
    await page.goto(`/admin/logs?seasonId=${fixture.seasonId}&page=2`); await expect(page.locator("tbody tr")).toHaveCount(15);
    await page.goto(`/admin/logs?seasonId=${fixture.seasonId}`); await expect(page.locator("tbody tr")).toHaveCount(50);
    await page.goBack(); await expect(page).toHaveURL(/page=2/); await expect(page.locator("tbody tr")).toHaveCount(15);
    await page.goForward(); await expect(page).not.toHaveURL(/page=2/); await expect(page.locator("tbody tr")).toHaveCount(50);
    console.info("ADMIN_IMMEDIATE_BROWSER", JSON.stringify({ directoryReads, matchLabelReads, pageRows: 50, distinctTargets: 30, targetTypes: 2, revokedNewRequestDenied: true }));
  } finally {
    await pool.query("delete from audit_logs where id=any($1::uuid[])", [logIds]);
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.end();
  }
});

test("慢概览仍允许教育审核队列先交互", async ({ page, scenario }) => {
  test.skip(process.env.RIVALHUB_EDU_SLOW_PROBE !== "1", "仅在本地临时服务器延迟注入时运行");
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const actor = scenario.accounts.find(account => account.key === "player2")!;
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const institution = randomUUID(), verification = randomUUID(), code = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  try {
    await pool.query("insert into institutions(id,name,source,source_version) values($1,$2,'manual','fixture')", [institution, `slow fixture ${institution}`]);
    await pool.query("insert into education_verifications(id,user_id,institution_id,academic_status,evidence_type,status,evidence_code) values($1,$2,$3,'enrolled','chsi_enrollment_report','pending',$4)", [verification, actor.userId, institution, code]);
    await signInProgrammatically(page, admin, scenario, "/admin");
    await page.goto("/admin/education-verifications", { waitUntil: "commit" });
    await expect(page.getByText("正在读取教育认证概览…", { exact: true })).toBeVisible();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    const status = page.getByRole("combobox", { name: "认证状态" });
    await expect(status).toBeVisible();
    await status.selectOption("all");
    await expect(page).toHaveURL(/status=all/);
    await expect(page.getByText("正在读取教育认证概览…", { exact: true })).toBeVisible();
    console.info("ADMIN_EDU_SLOW_BROWSER", JSON.stringify({ pendingEvidenceVisible: true, overviewPendingWhileQueueFilterNavigated: true }));
  } finally {
    await pool.query("delete from education_verifications where id=$1", [verification]);
    await pool.query("delete from institutions where id=$1", [institution]);
    await pool.end();
  }
});

test("真实canonical冻结32队的后台总览只显示摘要", async ({ page, scenario }) => {
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const directory = await mkdtemp(join(tmpdir(), "admin-frozen-browser-"));
  const bridge = join(directory, "fixture.json");
  const localUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL);
  const child = spawn(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.integration.config.ts", "tests/integration/db/major-prestart-selection.test.ts", "-t", "locks exactly the canonical capacity"], {
    env: { ...process.env, DATABASE_URL: localUrl, RIVALHUB_LOCAL_DATABASE_URL: localUrl, RIVALHUB_INTEGRATION_DATABASES: JSON.stringify([localUrl]), RIVALHUB_INTEGRATION_WORKERS: "1", RIVALHUB_OVERVIEW_BROWSER_BRIDGE: bridge }, stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stdout.on("data", data => { diagnostics += data.toString(); });
  child.stderr.on("data", data => { diagnostics += data.toString(); });
  const completed = new Promise<number | null>(done => { child.once("exit", code => done(code)); child.once("error", () => done(-1)); });
  try {
    await expect.poll(async () => { try { await readFile(bridge); return true; } catch { return false; } }, { timeout: 45_000 }).toBe(true);
    const fixture = JSON.parse(await readFile(bridge, "utf8")) as { slug: string; entrants: number; members: number; firstRosterUserId: string };
    expect(fixture.entrants).toBe(32); expect(fixture.members).toBe(160);
    await signInProgrammatically(page, admin, scenario, `/admin/${fixture.slug}`);
    await expect(page.getByText("32 / 32 队", { exact: true })).toBeVisible();
    const response = await page.request.get(`/admin/${fixture.slug}`, { headers: { RSC: "1" } });
    expect(response.ok()).toBe(true); expect(response.headers()["content-type"]).toContain("text/x-component");
    expect(await response.text()).not.toContain(fixture.firstRosterUserId);
    console.info("ADMIN_FROZEN_OVERVIEW_BROWSER", JSON.stringify({ entrants: fixture.entrants, members: fixture.members, summaryVisible: true, rosterIdentityAbsentFromFlight: true }));
  } finally {
    await writeFile(`${bridge}.release`, "release");
    const exit = await completed;
    await rm(directory, { recursive: true, force: true });
    expect(exit, diagnostics.slice(-1500)).toBe(0);
  }
});
