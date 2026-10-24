import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { accountKey, signTicket } from "@/lib/telemetry/ticket";
import { maintain, type Env } from "../../../workers/telemetry/index";

it("executes the real Worker and D1 API: concurrent ACK deduplication, usage and closed-day rollup", async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: object): Promise<{ outputFiles: { text: string }[] }> };
  const built = await build({ entryPoints: ["workers/telemetry/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
  const bindings = { SIGNING_KEY: "fixture-worker-signing-key".repeat(2), ADMIN_KEY: "fixture-worker-admin-key".repeat(2), ALLOWED_ORIGIN: "https://rivalhub.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1", SUMMARY_RETENTION_DAYS: "14" };
  const mf = new Miniflare({ modules: true, script: built.outputFiles![0].text, compatibilityDate: "2026-07-30", bindings, d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const now = Date.now(); const session = crypto.randomUUID();
    const account = await accountKey("fixture-user", "rivalhub-only");
    const ticket = await signTicket({ v: 1, id: crypto.randomUUID(), account, role: "user", release: "test", environment: "preview", origin: bindings.ALLOWED_ORIGIN, exp: now + 3600000 }, bindings.SIGNING_KEY);
    const body = JSON.stringify({ v: 1, id: crypto.randomUUID(), ticket, events: [
      { id: crypto.randomUUID(), at: now, session, route: "/", scene: "site", kind: "page" },
      { id: crypto.randomUUID(), at: now, session, route: "/stats", scene: "site", kind: "performance", metricName: "NAV_COMMIT", durationMs: 321 },
      { id: crypto.randomUUID(), at: now, session, route: "/stats", scene: "site", kind: "performance", metricName: "CLS", score: 0.125, client: { device: "mobile", browser: "safari", os: "ios", source: "none" } },
    ] });
    const send = () => mf.dispatchFetch("https://worker.invalid/v1/batches", { method: "POST", headers: { origin: bindings.ALLOWED_ORIGIN }, body });
    const responses = await Promise.all([send(), send(), send()]);
    expect(responses.map(r => r.status)).toEqual([204, 204, 204]);
    expect(await db.prepare("SELECT batches FROM usage").first()).toEqual({ batches: 1 });
    expect(await db.prepare("SELECT count(*) AS n FROM batches").first()).toEqual({ n: 1 });
    const response = await mf.dispatchFetch(`https://worker.invalid/admin/events?account=${account}`, { headers: { authorization: `Bearer ${bindings.ADMIN_KEY}` } });
    expect(response.status).toBe(200);
    const events = await response.text();
    expect(events).toContain(session);
    expect(events).toContain("0.125");
    await maintain({ ...bindings, DB: db as unknown as Env["DB"] }, now + 86400000);
    expect(await db.prepare("SELECT sum(events) AS events FROM summaries").first()).toEqual({ events: 2 });
    expect(await db.prepare("SELECT variant,events,duration_ms FROM summaries WHERE kind='performance'").first()).toEqual({ variant: "NAV_COMMIT", events: 1, duration_ms: 321 });
    const usage = await db.prepare("SELECT * FROM usage").all();
    expect(usage.meta.rows_read).toBeGreaterThan(0);
    await maintain({ ...bindings, DB: db as unknown as Env["DB"] }, now + 7 * 86400000);
    expect(await db.prepare("SELECT count(*) AS n FROM batches").first()).toEqual({ n: 0 });
  } finally { await mf.dispose(); }
}, 30000);
