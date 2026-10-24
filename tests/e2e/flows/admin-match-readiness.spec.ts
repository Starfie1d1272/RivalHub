import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { test, expect, signInProgrammatically } from "../fixtures";
import { createPredictionBrowserFixture, removePredictionBrowserFixture } from "../helpers/prediction-fixture";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import * as schema from "@/db/schema";

test.use({ scenarioProfile: "auth", trace: "on" });
test.setTimeout(180_000);

test("后台三 view 的可见内容、CLS 与分页保持真实范围", async ({ page, scenario }, testInfo) => {
  const actor = scenario.accounts[0]!;
  const fixture = await createPredictionBrowserFixture(actor.userId);
  const pool = new Pool({ connectionString: assertLocalDatabaseUrl(process.env.DATABASE_URL), ssl: false });
  const database = drizzle(pool, { schema });
  const baseline = process.env.RIVALHUB_ADMIN_READINESS_BASELINE === "1";
  const samples: unknown[] = [];
  try {
    await database.insert(schema.seasonAdminGrants).values({ seasonId: fixture.seasonId, userId: actor.userId });
    const match = await database.query.matches.findFirst({ where: eq(schema.matches.seasonId, fixture.seasonId) });
    if (!match?.entryAId || !match.entryBId) throw new Error("readiness fixture 缺少队伍");
    await page.addInitScript(() => {
      const state = { primaryDomReadyMs: null as number | null, lcpMs: null as number | null, shifts: [] as { start: number; value: number }[] };
      Object.assign(window, { __adminReadiness: state });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) state.lcpMs = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) state.shifts.push({ start: shift.startTime, value: shift.value });
        }
      }).observe({ type: "layout-shift", buffered: true });
      const observer = new MutationObserver(() => {
        const row = document.querySelector('section[aria-labelledby="match-list-scope"] div[id^="match-"], li[id^="material-"]');
        if (state.primaryDomReadyMs === null && row && row.getBoundingClientRect().height > 0) state.primaryDomReadyMs = performance.now();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await signInProgrammatically(page, actor, scenario, `/admin/${fixture.slug}/matches`);
    const ids: string[] = [];
    for (const size of [100, 500]) {
      const added = Array.from({ length: size - ids.length }, () => randomUUID()); ids.push(...added);
      await database.insert(schema.matches).values(added.map(id => ({ id, seasonId: fixture.seasonId,
        entryAId: match.entryAId!, entryBId: match.entryBId!, stage: "stage1", round: 1,
        format: "bo3" as const, status: "finished" as const, scoreA: 2, scoreB: 0, completedAt: new Date("2051-01-01T00:00:00Z") })));
      for (const view of ["execution", "schedule", "materials"]) {
        const url = `/admin/${fixture.slug}/matches?view=${view}&stage=stage1`;
        await page.goto(url);
        const rows = view === "materials" ? page.locator('li[id^="material-"]') : page.locator('section[aria-labelledby="match-list-scope"] div[id^="match-"]');
        await expect(rows).toHaveCount(view === "schedule" || baseline ? size + (view === "materials" ? 0 : 8) : 25);
        await page.waitForLoadState("networkidle");
        const metrics = await page.evaluate(() => {
          const state = (window as unknown as { __adminReadiness: { primaryDomReadyMs: number | null; lcpMs: number | null; shifts: { start: number; value: number }[] } }).__adminReadiness;
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          let max = 0, score = 0, start = 0, last = 0;
          for (const shift of state.shifts) {
            if (shift.start - last > 1000 || shift.start - start > 5000) { score = 0; start = shift.start; }
            score += shift.value; max = Math.max(max, score); last = shift.start;
          }
          return { primaryDomReadyMs: state.primaryDomReadyMs, lcpMs: state.lcpMs, cls: max,
            documentDecodedBodySize: nav.decodedBodySize, responseEndMs: nav.responseEnd, domNodes: document.getElementsByTagName("*").length };
        });
        expect(metrics.primaryDomReadyMs).not.toBeNull();
        samples.push({ version: process.env.RIVALHUB_ADMIN_READINESS_VERSION ?? "candidate", finishedMatches: size,
          activeMatches: 8, view, navigation: "hard", cache: "dev server warm; fixture/data fresh", ...metrics });
        if (!baseline && view !== "schedule") {
          await page.getByRole("button", { name: "下一页", exact: true }).click();
          await expect(page).toHaveURL(/page=2/);
          await expect(rows).toHaveCount(25);
          await page.goBack();
          await expect(page).not.toHaveURL(/page=2/);
          await expect(rows).toHaveCount(25);
        }
      }
    }
  } finally {
    const report = { environment: "isolated local fixture; desktop Chromium; development server", limitations: ["DOM row milestone, not Product CONTENT_READY or hydrated interaction time", "single sample per size/view; not p75/p95", "hard document includes HTML and RSC stream; bytes are decoded document size, not isolated RSC or wire size", "no production improvement claim"], samples };
    await testInfo.attach("admin-view-readiness", { body: JSON.stringify(report), contentType: "application/json" });
    if (process.env.RIVALHUB_ADMIN_READINESS_OUTPUT) writeFileSync(process.env.RIVALHUB_ADMIN_READINESS_OUTPUT, JSON.stringify(report, null, 2));
    await removePredictionBrowserFixture(fixture.seasonId);
    await pool.end();
  }
});
