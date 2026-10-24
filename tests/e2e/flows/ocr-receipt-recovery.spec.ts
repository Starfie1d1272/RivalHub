import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { chromium, type BrowserContext, type Page, type Route } from "@playwright/test";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { test as base, expect, signInProgrammatically, type E2EFixtureCredentials } from "../fixtures";

type Locator = { operationId: string; actorScope: string; mapId: string; expectedVersion: string; operation: string };
type OCRFixture = {
  pool: Pool; mapId: string; matchId: string; url: string; name: string;
  admin: E2EFixtureCredentials["accounts"][number]; other: E2EFixtureCredentials["accounts"][number];
  page: Page; restart: () => Promise<Page>; newTab: () => Promise<Page>;
};
const test = base.extend<{ ocr: OCRFixture }>({
  ocr: async ({ scenario, baseURL }, applyFixture, info) => {
    const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL, "OCR browser fixture"), ssl: false });
    const profile = info.outputPath("persistent-browser-profile");
    let context: BrowserContext | undefined;
    const admin = scenario.accounts.find(account => account.key === "admin")!;
    const other = scenario.accounts.find(account => account.key === "player2")!;
    let mapId: string | undefined;
    let matchId: string | undefined;
    const eventRosterId = randomUUID();
    try {
      const client = await pool.connect();
      let name: string;
      try {
        await client.query("BEGIN");
        const { rows: [match] } = await client.query<{ id: string; map_id: string; entry_a_id: string; current_roster_revision_id: string }>(
          "SELECT m.id, mm.id AS map_id, m.entry_a_id, e.current_roster_revision_id FROM matches m JOIN match_maps mm ON mm.match_id=m.id JOIN competition_entries e ON e.id=m.entry_a_id WHERE m.season_id=$1", [scenario.seasonId]);
        if (!match) throw new Error("OCR browser fixture missing its map");
        mapId = match.map_id; matchId = match.id;
        name = (await client.query<{ perfect_name: string }>("SELECT perfect_name FROM users WHERE id=$1", [other.userId])).rows[0]!.perfect_name;
        await client.query("UPDATE match_maps SET score_a=13,score_b=8,completed_at=now() WHERE id=$1", [mapId]);
        await client.query("UPDATE competition_entries SET approved_roster_revision_id=current_roster_revision_id WHERE id=$1", [match.entry_a_id]);
        await client.query("INSERT INTO event_rosters(id,entry_id,source_roster_revision_id) VALUES ($1,$2,$3)", [eventRosterId, match.entry_a_id, match.current_roster_revision_id]);
        await client.query("INSERT INTO event_roster_members(event_roster_id,user_id,is_primary_starter) VALUES ($1,$2,true)", [eventRosterId, other.userId]);
        await client.query("UPDATE event_rosters SET status='confirmed',confirmed_at=now(),confirmed_by=$2 WHERE id=$1", [eventRosterId, admin.userId]);
        await client.query("UPDATE event_rosters SET status='frozen',frozen_at=now(),frozen_by=$2 WHERE id=$1", [eventRosterId, admin.userId]);
        await client.query("INSERT INTO season_admin_grants(user_id,season_id) VALUES ($1,$2)", [other.userId, scenario.seasonId]);
        await client.query(`INSERT INTO match_player_stats(map_id,match_id,user_id,perfect_name,kills,deaths,assists,hs_percent,first_kills,multi_kills,clutches,adr,rws,rating_pro,we,verified_by_admin,verified_at)
          VALUES ($1,$2,$3,$4,15,10,4,40,1,1,0,80,10,1.2,8,$5,now())`, [mapId, matchId, other.userId, name, admin.userId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      const launch = async () => {
        context = await chromium.launchPersistentContext(profile, { headless: true, baseURL, viewport: { width: 1280, height: 900 } });
        context.setDefaultTimeout(15_000);
        context.setDefaultNavigationTimeout(60_000);
        return context.pages()[0] ?? await context.newPage();
      };
      const page = await launch();
      await applyFixture({ pool, mapId: mapId!, matchId: matchId!, name: name!, admin, other, page,
        url: `/admin/${scenario.slug}/matches/${matchId}`,
        restart: async () => { await context!.close(); return launch(); },
        newTab: async () => context!.newPage(),
      });
    } finally {
      await context?.close();
      rmSync(profile, { recursive: true, force: true });
      // Only synthetic scenario-owned rows; remove child facts before the
      // canonical scenario fixture teardown disables provenance triggers.
      if (mapId) {
        await pool.query("DELETE FROM operator_scoreboard_receipts WHERE map_id=$1", [mapId]);
        await pool.query("DELETE FROM match_player_stats WHERE map_id=$1", [mapId]);
      }
      await pool.query("DELETE FROM season_admin_grants WHERE user_id=$1 AND season_id=$2", [other.userId, scenario.seasonId]);
      // Frozen fixture rows require the same local-only teardown boundary as
      // the canonical scenario cleaner; all predicates use this scenario ID.
      const cleanup = await pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query("SET LOCAL session_replication_role=replica");
        await cleanup.query("DELETE FROM event_roster_members WHERE event_roster_id=$1", [eventRosterId]);
        await cleanup.query("DELETE FROM event_rosters WHERE id=$1", [eventRosterId]);
        await cleanup.query("COMMIT");
      } catch (error) { await cleanup.query("ROLLBACK"); throw error; }
      finally { cleanup.release(); await pool.end(); }
    }
  },
});
test.use({ scenarioProfile: "stats" });
test.setTimeout(120_000);
test.skip(({ isMobile }) => isMobile, "Persistent desktop profile evidence; mobile is a separate cohort.");

async function panelFor(page: Page, ocr: OCRFixture) {
  const panel = page.locator(`#scoreboard-${ocr.mapId}`);
  await expect(panel).toBeVisible();
  if (!await panel.evaluate(element => (element as HTMLDetailsElement).open)) await panel.locator("summary").click();
  await expect(panel.getByRole("heading", { name: /玩家数据/ })).toBeVisible();
  return panel;
}
async function open(page: Page, ocr: OCRFixture, scenario: E2EFixtureCredentials, actor = ocr.admin) {
  await signInProgrammatically(page, actor, scenario, ocr.url);
  return panelFor(page, ocr);
}
async function edit(page: Page, ocr: OCRFixture, rating: string) {
  const panel = await panelFor(page, ocr);
  await panel.getByRole("button", { name: "重新录入", exact: true }).click();
  await panel.getByLabel(`${ocr.name} Rating`, { exact: true }).fill(rating);
  return panel;
}
async function originalLocator(page: Page, ocr: OCRFixture): Promise<Locator> {
  const values = await page.evaluate(mapId => Object.entries(localStorage).filter(([key]) => key.startsWith(`rivalhub:scoreboard-operation:v1:${mapId}:`)).map(([, value]) => JSON.parse(value)), ocr.mapId);
  expect(values).toHaveLength(1);
  expect(Object.keys(values[0]).sort()).toEqual(["actorScope", "expectedVersion", "mapId", "operation", "operationId"].sort());
  return values[0] as Locator;
}
async function submitWithoutResponse(page: Page, ocr: OCRFixture, committed: boolean) {
  const panel = await edit(page, ocr, "1.4");
  let dropped = false;
  const handler = async (route: Route) => {
    if (!dropped && route.request().method() === "POST" && route.request().headers()["next-action"] && route.request().postData()?.includes("operationId") && route.request().postData()?.includes(ocr.mapId)) {
      dropped = true;
      if (committed) await route.fetch(); // Real server execution and COMMIT.
      await route.abort("failed"); // Drop the HTTP response, not an adapter mock.
    } else await route.continue();
  };
  await page.route("**/*", handler);
  try {
    await panel.getByRole("button", { name: "确认保存", exact: true }).click();
    await expect(panel.getByRole("button", { name: "核对原操作提交凭据" })).toBeVisible();
  } finally { await page.unroute("**/*", handler); }
  expect(dropped).toBe(true);
  return originalLocator(page, ocr);
}
async function counts(ocr: OCRFixture) {
  const receipts = await ocr.pool.query("SELECT operation_id,actor_user_id FROM operator_scoreboard_receipts WHERE map_id=$1", [ocr.mapId]);
  const audits = await ocr.pool.query("SELECT id FROM audit_logs WHERE target_id=$1 AND action='match.save_player_stats'", [ocr.mapId]);
  const facts = await ocr.pool.query("SELECT rating_pro FROM match_player_stats WHERE map_id=$1", [ocr.mapId]);
  return { receipts: receipts.rows, audits: audits.rows.length, ratings: facts.rows.map(row => row.rating_pro) };
}

test("真实非空提交丢响应后关闭整个浏览器重开，fresh 权限与 actor 隔离后只读确认原回执", async ({ ocr, scenario }, info) => {
  await open(ocr.page, ocr, scenario);
  const locator = await submitWithoutResponse(ocr.page, ocr, true);
  expect(await counts(ocr)).toMatchObject({ receipts: [{ operation_id: locator.operationId, actor_user_id: ocr.admin.userId }], audits: 1, ratings: [1.4] });
  let page = await ocr.restart();
  let panel = await open(page, ocr, scenario, ocr.other);
  await expect(panel.getByRole("button", { name: "核对原操作提交凭据" })).toHaveCount(0);
  expect((await originalLocator(page, ocr)).actorScope).toBe(ocr.admin.userId);
  page = await ocr.restart();
  panel = await open(page, ocr, scenario);
  await expect(panel.getByText("原操作编号已恢复；关闭前的草稿未持久保存。", { exact: true })).toBeVisible();
  await ocr.pool.query("UPDATE users SET role='user' WHERE id=$1", [ocr.admin.userId]);
  await panel.getByRole("button", { name: "核对原操作提交凭据" }).click();
  await expect(panel.getByText("权限不足", { exact: true })).toBeVisible();
  expect(await counts(ocr)).toMatchObject({ audits: 1, ratings: [1.4] });
  await ocr.pool.query("UPDATE users SET role='super_admin' WHERE id=$1", [ocr.admin.userId]);
  await panel.getByRole("button", { name: "核对原操作提交凭据" }).click();
  await expect(panel.getByRole("button", { name: "核对原操作提交凭据" })).toHaveCount(0);
  expect(await counts(ocr)).toMatchObject({ audits: 1, ratings: [1.4] });
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("rivalhub:scoreboard-operation:")))).toEqual([]);
  await info.attach("receipt-proof", { body: JSON.stringify({ scenario: "committed-network-response-dropped", browserRestarts: 2, receiptCount: 1, auditCount: 1, actorIsolation: true, freshPermissionDenial: true }), contentType: "application/json" });
});

test("请求未发送时重开只报 missing，不把当前相似数据当提交成功或重写", async ({ ocr, scenario }, info) => {
  await open(ocr.page, ocr, scenario);
  const locator = await submitWithoutResponse(ocr.page, ocr, false);
  expect(await counts(ocr)).toMatchObject({ receipts: [], audits: 0, ratings: [1.2] });
  const page = await ocr.restart();
  const panel = await open(page, ocr, scenario);
  await panel.getByRole("button", { name: "核对原操作提交凭据" }).click();
  await expect(panel.getByText(/尚未找到原请求的提交凭据/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "重新录入", exact: true })).toBeDisabled();
  expect((await originalLocator(page, ocr)).operationId).toBe(locator.operationId);
  expect(await counts(ocr)).toMatchObject({ receipts: [], audits: 0, ratings: [1.2] });
  await info.attach("receipt-proof", { body: JSON.stringify({ scenario: "request-aborted-before-server", receiptCount: 0, auditCount: 0, originalLocatorRetained: true, replayCount: 0 }), contentType: "application/json" });
});

test("原提交之后另一管理员真实保存，重开显示 superseded 且不覆盖后续统计", async ({ ocr, scenario }, info) => {
  await open(ocr.page, ocr, scenario);
  await submitWithoutResponse(ocr.page, ocr, true);
  const otherPage = await ocr.newTab();
  await open(otherPage, ocr, scenario, ocr.other);
  const otherPanel = await edit(otherPage, ocr, "1.6");
  await otherPanel.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(otherPanel.getByRole("button", { name: "重新录入", exact: true })).toBeVisible();
  expect(await counts(ocr)).toMatchObject({ audits: 2, ratings: [1.6] });
  const page = await ocr.restart();
  const panel = await open(page, ocr, scenario);
  await panel.getByRole("button", { name: "核对原操作提交凭据" }).click();
  await expect(panel.getByText(/原提交已确认，但已有后续更改/)).toBeVisible();
  expect(await counts(ocr)).toMatchObject({ audits: 2, ratings: [1.6] });
  expect((await counts(ocr)).receipts).toHaveLength(2);
  await info.attach("receipt-proof", { body: JSON.stringify({ scenario: "superseded-by-second-admin-save", receiptCount: 2, auditCount: 2, currentRating: 1.6, replayCount: 0 }), contentType: "application/json" });
});

test("编辑后另一 tab 切换 actor，旧 command 真实请求被拒绝而不以新 actor 提交", async ({ ocr, scenario }, info) => {
  await open(ocr.page, ocr, scenario);
  const panel = await edit(ocr.page, ocr, "1.4");
  const otherTab = await ocr.newTab();
  await signInProgrammatically(otherTab, ocr.other, scenario, ocr.url);
  await panel.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(panel.getByText("登录身份已变化，请重新读取计分板后再操作。", { exact: true })).toBeVisible();
  expect(await counts(ocr)).toMatchObject({ receipts: [], audits: 0, ratings: [1.2] });
  expect(await ocr.page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("rivalhub:scoreboard-operation:")))).toEqual([]);
  await info.attach("receipt-proof", { body: JSON.stringify({ scenario: "actor-changed-in-other-tab-before-save", rejected: true, receiptCount: 0, auditCount: 0, currentRating: 1.2 }), contentType: "application/json" });
});
