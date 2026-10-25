import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { test, expect, signInProgrammatically } from "../fixtures";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { telemetryBoundary } from "./admin-telemetry-boundary";

test.use({ scenarioProfile: "layout", trace: "on" });
test.setTimeout(180000);

test("bounded provider delay and legal telemetry response browser profile", async ({ page, scenario, context }, testInfo) => {
  test.skip(process.env.RIVALHUB_ADMIN_FINAL_PROBE !== "1", "Explicit isolated HTTPS fixture and temporary provider patch required");
  const boundary = telemetryBoundary();
  const port = Number(process.env.RIVALHUB_ADMIN_PROBE_PORT);
  const requests: { path: string; at: number; delayed: boolean }[] = [];
  const server = createServer({ key: readFileSync("/tmp/admin-final-probes/key.pem"), cert: readFileSync("/tmp/admin-final-probes/cert.pem") }, (req, res) => {
    const url = new URL(req.url!, `https://localhost:${port}`);
    const delayed = url.searchParams.get("id") === "99112233";
    requests.push({ path: url.pathname, at: Date.now(), delayed });
    const answer = () => { if (!res.destroyed) { res.setHeader("Content-Type", "application/json"); res.end(url.pathname === "/admin/analysis" ? boundary.body : JSON.stringify({ code: 0, data: { live_status: 0 } })); } };
    if (delayed) setTimeout(answer, 3000); else answer();
  });
  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const admin = scenario.accounts.find(a => a.key === "admin")!;
  const fixture = await createPredictionBrowserFixture(admin.userId);
  const report: Record<string, unknown> = { referenceMain: "3830c0467d6811e426bf8787238d17d85a1b7d0f", referenceTree: "39199e89d8a98006afa17d97ca5d4656958fea39", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(), environment: "loopback real PG/auth/Chromium; dev warm route; synthetic HTTPS provider", productionClaim: false };
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      const state = { primaryDomMs: null as number | null, advancedDomMs: null as number | null, fallbackMs: null as number | null, shifts: [] as { at: number; value: number }[], longTasks: [] as { at: number; duration: number }[], ready: [] as unknown[] };
      Object.assign(window, { __adminFinalProbe: state });
      new PerformanceObserver(list => { for (const e of list.getEntries()) { const s = e as PerformanceEntry & { value: number; hadRecentInput: boolean }; if (!s.hadRecentInput) state.shifts.push({ at: s.startTime, value: s.value }); } }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver(list => { for (const e of list.getEntries()) state.longTasks.push({ at: e.startTime, duration: e.duration }); }).observe({ type: "longtask", buffered: true });
      new MutationObserver(() => {
        if (state.primaryDomMs === null && document.querySelector("#operator-task")?.getBoundingClientRect().height) state.primaryDomMs = performance.now();
        if (state.fallbackMs === null && document.body?.textContent?.includes("正在读取转播状态")) state.fallbackMs = performance.now();
        if (state.advancedDomMs === null && document.querySelector('aside[aria-label="转播状态"]')?.getBoundingClientRect().height) state.advancedDomMs = performance.now();
      }).observe(document, { childList: true, subtree: true });
      const send = window.fetch.bind(window);
      window.fetch = async (...args) => {
        if (String(args[0]).includes("/v1/batches") && args[1]?.method === "POST") {
          const batch = JSON.parse(String(args[1].body)) as { events: { kind: string }[] };
          state.ready.push(...batch.events.filter(e => e.kind === "ready"));
          return new Response("", { status: 202 });
        }
        return send(...args);
      };
    });
    if (process.env.RIVALHUB_ADMIN_PROBE_PHASE === "telemetry") {
      report.workbench = JSON.parse(readFileSync("/workspace/admin-final-bounded-probes-partial.json", "utf8")).workbench;
      await signInProgrammatically(page, admin, scenario, "/account");
    } else {
    const match = (await pool.query<{ id: string }>("select id from matches where season_id=$1 order by id limit 1", [fixture.seasonId])).rows[0]!;
    await pool.query("insert into match_commentators(match_id,user_id,added_by_user_id) values($1,$2,$2)", [match.id, admin.userId]);
    const url = `/admin/${fixture.slug}/matches/${match.id}`;
    await pool.query("update users set live_stream_url='https://live.bilibili.com/99112232' where id=$1", [admin.userId]);
    await signInProgrammatically(page, admin, scenario, url);
    await expect(page.getByRole("complementary", { name: "转播状态" })).toContainText("未开播");
    const samples: unknown[] = [];
    for (const delayed of [false, true]) {
      if (delayed) await pool.query("update users set live_stream_url='https://live.bilibili.com/99112233' where id=$1", [admin.userId]);
      await page.goto(url, { waitUntil: "commit" });
      await expect(page.locator("#operator-task")).toBeVisible();
      if (delayed) {
        await expect(page.getByText("正在读取转播状态…", { exact: true })).toBeVisible();
        await page.getByText("弃赛 / 判负", { exact: true }).click();
        await page.getByRole("button", { name: "判负弃赛", exact: true }).click();
        await expect(page.getByPlaceholder("例如：超过宽限仍无法组成合法首发")).toBeVisible();
        expect(await page.locator('aside[aria-label="转播状态"]').count()).toBe(0);
      }
      await expect(page.getByRole("complementary", { name: "转播状态" })).toContainText(delayed ? "无法确认" : "未开播");
      console.info("PROBE_BEFORE_FLUSH", { delayed, bootstrapFlag: (await page.content()).includes("measurementVersion") });
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await page.waitForFunction(() => { window.dispatchEvent(new Event("pagehide")); return (window as unknown as { __adminFinalProbe: { ready: unknown[] } }).__adminFinalProbe.ready.length > 0; }, undefined, { timeout: 15000 });
      const sample = await page.evaluate(() => {
        const s = (window as unknown as { __adminFinalProbe: { primaryDomMs: number; advancedDomMs: number; fallbackMs: number; shifts: { at: number; value: number }[]; ready: unknown[] } }).__adminFinalProbe;
        let cls = 0, score = 0, start = 0, last = 0;
        for (const shift of s.shifts) { if (shift.at - last > 1000 || shift.at - start > 5000) { score = 0; start = shift.at; } score += shift.value; cls = Math.max(cls, score); last = shift.at; }
        return { ...s, cls, primaryTask: document.querySelector("#operator-task")?.textContent, authorityText: document.querySelector('section[aria-labelledby="operator-task"]')?.textContent };
      });
      expect(sample.primaryDomMs).toBeLessThan(sample.advancedDomMs);
      samples.push({ delayed, ...sample });
    }
    report.workbench = { injectedProviderMs: 3000, existingTimeoutMs: 2500, delayedRequests: requests.filter(r => r.delayed).length, samples };

    }

    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    await page.goto("about:blank");
    const before = await cdp.send("Performance.getMetrics");
    await page.goto("/admin/telemetry?hours=168", { waitUntil: "commit" });
    await expect(page.getByRole("tab", { name: "访问概览", exact: true })).toBeVisible();
    const phases: unknown[] = [];
    report.telemetry = { responseBytes: Buffer.byteLength(boundary.body), phases };
    const capture = async (label: string, interactionStart?: number) => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await cdp.send("Performance.getMetrics");
      const dom = await cdp.send("Memory.getDOMCounters");
      const browser = await page.evaluate(() => ({ at: performance.now(), nodes: document.getElementsByTagName("*").length, longTasks: (window as unknown as { __adminFinalProbe: { longTasks: unknown[] } }).__adminFinalProbe.longTasks }));
      phases.push({ label, automationInteractionMs: interactionStart === undefined ? null : browser.at - interactionStart, metrics: Object.fromEntries(metrics.metrics.filter(m => ["TaskDuration", "ScriptDuration", "LayoutDuration", "JSHeapUsedSize"].includes(m.name)).map(m => [m.name, m.value])), dom, ...browser });
    };
    await capture("overview");
    for (const label of ["使用行为", "页面性能", "异常与拒绝", "采集状态", "访问概览"]) {
      const tab = page.getByRole("tab", { name: label, exact: false });
      const start = await page.evaluate(() => performance.now());
      await tab.click(); await expect(tab).toHaveAttribute("data-state", "active"); await capture(label, start);
    }
    await page.getByRole("button", { name: /更多筛选/ }).click();
    const openStart = await page.evaluate(() => performance.now());
    await page.getByRole("combobox", { name: "部署版本", exact: true }).click();
    await expect(page.getByRole("option")).toHaveCount(2001);
    await capture("release-dropdown-2001-options", openStart);
    await page.keyboard.press("Escape");
    const profile = await cdp.send("Profiler.stop");
    report.telemetry = { query: "hours=168", responseBytes: Buffer.byteLength(boundary.body), schemaValidated: true, upstreamBudget: boundary.data.meta, cardinalities: Object.fromEntries(["routes", "operations", "variants", "filterRows", "performanceRoutes", "metricSegments", "errorGroups", "sessions", "timeline"].map(k => [k, (boundary.data[k as keyof typeof boundary.data] as unknown[]).length])), serverHttpsQueries: requests.filter(r => r.path === "/admin/analysis").length, baseline: before.metrics.filter(m => ["TaskDuration", "ScriptDuration", "LayoutDuration", "JSHeapUsedSize"].includes(m.name)), phases, cpuProfile: { samples: profile.profile.samples?.length, durationUs: profile.profile.endTime - profile.profile.startTime } };
    await testInfo.attach("bounded-probe-summary", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    writeFileSync("/workspace/admin-final-bounded-probes-results.json", JSON.stringify(report, null, 2));
  } finally {
    writeFileSync("/workspace/admin-final-bounded-probes-partial.json", JSON.stringify(report, null, 2));
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.end();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
