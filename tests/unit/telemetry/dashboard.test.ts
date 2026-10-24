import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it("protects dashboard queries and bounds D1 summaries without exposing identities or expired/preview batches", async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: object): Promise<{ outputFiles: { text: string }[] }> };
  const built = await build({ entryPoints: ["workers/telemetry/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
  const bindings = { SIGNING_KEY: "fixture-signing-key".repeat(3), ADMIN_KEY: "fixture-admin-key".repeat(3), DASHBOARD_KEY: "fixture-dashboard-key".repeat(3), ALLOWED_ORIGIN: "https://rivalhub.invalid" };
  const mf = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: "2026-07-30", bindings, d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const now = Date.now();
    const summary = JSON.stringify([
      ["site", "/", "page", "", "", "", "", 2, 0, null, { device: "mobile", browser: "safari", os: "ios", source: "none" }],
      ["site", "/stats", "performance", "", "", "", "LCP", 1, 123, null, null, "sample-lcp", now - 1000],
      ["site", "/stats", "performance", "", "", "", "CLS", 1, 0, 0.1, null, "sample-cls", now - 1000],
      ["site", "/", "performance", "", "", "", "CLS", 1, 0],
      ["site", "/stats", "performance", "", "", "", "LCP", 2, 999],
      ["site", "/", "operation", "auth.loginWithPassword", "start", "", "", 1, 0],
      ["site", "/", "operation", "auth.loginWithPassword", "success", "", "", 1, 150],
    ]);
    for (const [id, environment, expires] of [["valid", "production", now + 1200000], ["preview", "preview", now + 600000], ["expired", "production", now - 1]] as const) {
      await db.prepare("INSERT INTO batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("private-ticket", id, id === "valid" ? now - 10000 : now, expires, new Date(now).toISOString().slice(0, 10), "private-account", "private-session", "user", "test", environment, 100, new Uint8Array([0]), summary).run();
    }
    const headers = { authorization: `Bearer ${bindings.ADMIN_KEY}` };
    expect((await mf.dispatchFetch("https://worker.invalid/admin/dashboard")).status).toBe(401);
    expect((await mf.dispatchFetch("https://worker.invalid/admin/dashboard?hours=999", { headers })).status).toBe(400);
    expect((await mf.dispatchFetch("https://worker.invalid/admin/dashboard?route=/secret/token", { headers })).status).toBe(400);
    expect((await mf.dispatchFetch("https://worker.invalid/admin/dashboard?account=private-account", { headers })).status).toBe(400);
    const response = await mf.dispatchFetch("https://worker.invalid/admin/dashboard?release=test", { headers });
    expect(response.status).toBe(200);
    const readerHeaders = { authorization: `Bearer ${bindings.DASHBOARD_KEY}` };
    expect((await mf.dispatchFetch("https://worker.invalid/admin/dashboard", { headers: readerHeaders })).status).toBe(200);
    for (const path of ["/admin/usage", "/admin/summary", "/admin/events?session=private-session", "/admin/dashboard/private"]) {
      expect((await mf.dispatchFetch(`https://worker.invalid${path}`, { headers: readerHeaders })).status).toBe(401);
    }
    expect((await mf.dispatchFetch("https://worker.invalid/admin/dashboard", { method: "POST", headers: readerHeaders })).status).toBe(405);
    expect((await mf.dispatchFetch("https://worker.invalid/admin/dashboard", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    const text = await response.text();
    expect(text).not.toMatch(/private-|events_gzip|SIGNING_KEY|ADMIN_KEY/);
    const data = JSON.parse(text);
    expect(data.sampledBatches).toBe(1);
    expect(data.legacyPerformanceReports).toBe(2);
    expect(data.performance.filter((row: { metric: string }) => row.metric === "CLS")).toHaveLength(1);
    expect(data.clients).toContainEqual({ dimension: "device", value: "mobile", pages: 2 });
    expect(data.totals).toMatchObject({ page: 2, start: 1, success: 1 });
    expect(data.performance).toContainEqual({ route: "/stats", metric: "LCP", reports: 1, durationMs: 123 });
    expect(data.performance).toContainEqual({ route: "/stats", metric: "CLS", reports: 1, durationMs: 0, score: 0.1 });
    const filtered = await mf.dispatchFetch("https://worker.invalid/admin/dashboard?route=/stats", { headers });
    expect((await filtered.json() as { totals: { page: number } }).totals.page).toBe(0);
    // A later report may decrease (INP), and an older value can arrive later.
    for (const [id, received, at, value] of [["new", now - 5, now - 10, 80], ["late-old", now - 1, now - 100, 900]] as const) {
      const report = JSON.stringify([["site", "/stats", "performance", "", "", "", "LCP", 1, value, null, null, "sample-lcp", at]]);
      await db.prepare("INSERT INTO batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("private-ticket", id, received, now + 1200000, new Date(now).toISOString().slice(0, 10), "private-account", "private-session", "user", "test", "production", 100, new Uint8Array([0]), report).run();
    }
    const updated = await (await mf.dispatchFetch("https://worker.invalid/admin/dashboard", { headers })).json() as { performance: unknown[] };
    expect(updated.performance).toContainEqual({ route: "/stats", metric: "LCP", reports: 1, durationMs: 80 });
    const newerSummary = JSON.parse(summary);
    newerSummary[0][7] = 3;
    await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000)
      INSERT INTO batches SELECT 'fixture',cast(x AS TEXT),?,?,?,'private-account','private-session','user','test','production',1,X'00',? FROM n`)
      .bind(now, now + 600000, new Date(now).toISOString().slice(0, 10), JSON.stringify(newerSummary)).run();
    const bounded = await mf.dispatchFetch("https://worker.invalid/admin/dashboard", { headers });
    const sampled = await bounded.json() as { trend: { at: number }[]; truncated: boolean; sampledBatches: number; totals: { page: number } };
    expect(sampled.truncated).toBe(true);
    expect(sampled.sampledBatches).toBe(1000);
    expect(sampled.totals.page).toBe(3000);
    expect(sampled.trend[0].at).toBe(Math.floor(now / 3600000) * 3600000);
  } finally { await mf.dispose(); }
}, 30000);
