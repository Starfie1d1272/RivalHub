import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { accountKey, signTicket } from "@/lib/telemetry/ticket";
import { maintain, type Env } from "../../../workers/telemetry/index";
import { maintainDbTraffic, readDbTrafficHours } from "../../../workers/telemetry/db-traffic-rollup";

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

 it("stores bounded database windows idempotently and expires them", async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: object): Promise<{ outputFiles: { text: string }[] }> };
  const built = await build({ entryPoints: ["workers/telemetry/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
  const bindings = { SIGNING_KEY: "fixture-signing-key".repeat(3), ADMIN_KEY: "fixture-admin-key".repeat(3), DB_TRAFFIC_KEY: "fixture-db-key".repeat(3), ALLOWED_ORIGIN: "https://rivalhub.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1" };
  const mf = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: "2026-07-30", bindings, d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const now = Date.now();
    const body = JSON.stringify({ id: crypto.randomUUID(), process: crypto.randomUUID(), at: now, release: "fixture", deployment: "fixture", dropped: 2, receivedBytes: 123, connections: 1, observedConnections: 1, rows: [{ source: "mizar", template: "q1234567890abcdef", queries: 3, failures: 1, rows: 5, queryMs: 12 }] });
    const send = () => mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body });
    expect((await Promise.all([send(), send()])).map(r => r.status)).toEqual([204, 204]);
    expect((await mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", body })).status).toBe(401);
    const heavy = JSON.parse(body); heavy.id = crypto.randomUUID(); heavy.dropped = 0; heavy.receivedBytes = 0;
    heavy.rows = Array.from({ length: 21 }, (_, i) => ({ source: "mizar", template: "q" + i.toString(16).padStart(16, "0"), queries: i < 20 ? 100 : 1, failures: 0, rows: i < 20 ? 1 : 1000000, queryMs: i < 20 ? 1 : 60000 }));
    expect((await mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body: JSON.stringify(heavy) })).status).toBe(204);
    const future = JSON.parse(body); future.id = crypto.randomUUID(); future.at = now + 50000; future.rows[0].queries = 99;
    expect((await mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body: JSON.stringify(future) })).status).toBe(204);
    const offline = { consumer: "preview", run: "123", release: "v1", started: now - 1000, ended: now, status: "exported", rows: 2, logicalBytes: 100, dumpBytes: null, snapshotBytes: 70, artifactBytes: null, storageBytes: null };
    const sendOffline = () => mf.dispatchFetch("https://worker.invalid/v1/db-offline", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body: JSON.stringify(offline) });
    expect((await Promise.all([sendOffline(), sendOffline()])).map(r => r.status)).toEqual([204, 204]);
    await Promise.all([maintainDbTraffic({ ...bindings, DB: db as unknown as Env["DB"] }, now + 1), maintainDbTraffic({ ...bindings, DB: db as unknown as Env["DB"] }, now + 1)]);
    await maintainDbTraffic({ ...bindings, DB: db as unknown as Env["DB"] }, now + 1);
    const result = await mf.dispatchFetch("https://worker.invalid/admin/db-traffic", { headers: { authorization: `Bearer ${bindings.ADMIN_KEY}` } });
    expect(result.status).toBe(200);
    const data = await result.json() as { dropped: number; receivedBytes: number; offline: unknown[]; sources: Array<{ queries: number; rows: number; queryMs: number }>; byTime: Array<{ template: string }>; byRows: Array<{ template: string }> };
    expect(data).toMatchObject({ dropped: 2, receivedBytes: 123, offline: [offline], sources: [{ queries: 2004, rows: 1000025, queryMs: 60032 }] });
    expect(data.byTime[0].template).toBe("q0000000000000014");
    expect(data.byRows[0].template).toBe("q0000000000000014");
    const burst = JSON.parse(body); burst.id = crypto.randomUUID(); burst.dropped = 0; burst.receivedBytes = 0;
    burst.rows = Array.from({ length: 100 }, (_, i) => ({ source: "mizar", template: "q" + (1000 + i).toString(16).padStart(16, "0"), queries: 1, failures: 0, rows: 1, queryMs: 1 }));
    expect((await mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body: JSON.stringify(burst) })).status).toBe(204);
    const truncated = await mf.dispatchFetch("https://worker.invalid/admin/db-traffic", { headers: { authorization: `Bearer ${bindings.ADMIN_KEY}` } });
    const afterBurst = await truncated.json() as { truncated: boolean; sources: Array<{ queries: number }>; byRows: Array<{ template: string }> };
    expect(afterBurst.truncated).toBe(true);
    expect(afterBurst.sources[0].queries).toBe(2104);
    expect(afterBurst.byRows[0].template).toBe("q0000000000000014");

    await maintain({ ...bindings, DB: db as unknown as Env["DB"] }, now + 8 * 86400000);
    expect(await db.prepare("SELECT count(*) AS n FROM db_traffic_batches").first()).toEqual({ n: 0 });
    expect(await db.prepare("SELECT count(*) AS n FROM db_offline_runs").first()).toEqual({ n: 0 });
  } finally { await mf.dispose(); }
}, 30000);

it("atomically rolls up the same pending batches under concurrent workers", async () => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response() } }", compatibilityDate: "2026-07-30", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const now = Date.now();
    const payload = JSON.stringify([{ source: "mizar", template: "q0000000000000001", queries: 1, failures: 0, rows: 2, queryMs: 3 }]);
    await db.batch(Array.from({ length: 10 }, (_, i) => db.prepare("INSERT INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(`fixture-${i}`, now, "process", "release", "deployment", payload, now + 86400000, 0, 1, 1, 1)));
    const env = { DB: db as unknown as Env["DB"] } as Env;
    await Promise.all(Array.from({ length: 4 }, () => maintainDbTraffic(env, now)));
    await maintainDbTraffic(env, now);
    const stored = await db.prepare("SELECT payload FROM db_traffic_hours").first<{ payload: string }>();
    const result = JSON.parse(stored!.payload);
    expect(result.sources).toMatchObject([{ source: "mizar", queries: 10, rows: 20, queryMs: 30 }]);
    expect(await db.prepare("SELECT count(*) AS n FROM db_traffic_batches WHERE processed=0").first()).toEqual({ n: 0 });
  } finally { await mf.dispose(); }
}, 30000);

it("rejects stale pending selections after another consumer or expiry cleanup", async () => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response() } }", compatibilityDate: "2026-07-30", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const now = Date.now();
    const payload = JSON.stringify([{ source: "mizar", template: "q0000000000000001", queries: 1, failures: 0, rows: 2, queryMs: 3 }]);
    for (const interference of ["consumer", "cleanup", "hour_cleanup"] as const) {
      await db.batch([db.prepare("DELETE FROM db_traffic_hours"), db.prepare("DELETE FROM db_traffic_batches")]);
      await db.prepare("INSERT INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind("fixture", now, "process", "release", "deployment", payload, now + 86400000, 0, 10, 1, 1).run();
      if (interference === "hour_cleanup") {
        await maintainDbTraffic({ DB: db as unknown as Env["DB"] } as Env, now, 1);
        await db.prepare("UPDATE db_traffic_batches SET processed=0 WHERE id=?").bind("fixture").run();
      }
      let captured!: () => void; let resume!: () => void;
      const selected = new Promise<void>(resolve => { captured = resolve; });
      const released = new Promise<void>(resolve => { resume = resolve; });
      const delayed = {
        prepare(sql: string) {
          return { bind(...values: (string | number | null | ArrayBuffer)[]) {
            const native = db.prepare(sql).bind(...values);
            return { native, first: () => native.first(), async all() {
              const result = await native.all();
              if (sql.startsWith("SELECT id,at,process")) { captured(); await released; }
              return result;
            } };
          } };
        },
        batch(statements: Array<{ native: ReturnType<typeof db.prepare> }>) { return db.batch(statements.map(statement => statement.native)); },
      } as unknown as Env["DB"];
      const waiting = maintainDbTraffic({ DB: delayed } as Env, now, 1);
      await selected;
      if (interference === "consumer") await maintainDbTraffic({ DB: db as unknown as Env["DB"] } as Env, now, 1);
      else if (interference === "cleanup") await db.prepare("DELETE FROM db_traffic_batches WHERE id=?").bind("fixture").run();
      else await db.prepare("DELETE FROM db_traffic_hours").run();
      resume(); await waiting;
      const hour = await db.prepare("SELECT version,payload FROM db_traffic_hours").first<{ version: number; payload: string }>();
      if (interference !== "consumer") expect(hour).toBeNull();
      else {
        expect(hour!.version).toBe(1);
        expect(JSON.parse(hour!.payload)).toMatchObject({ receivedBytes: 10, sources: [{ queries: 1, rows: 2, queryMs: 3 }] });
      }
    }
  } finally { await mf.dispose(); }
}, 30000);


it("marks producer overflow as truncated even when hourly shape capacity remains", async () => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response() } }", compatibilityDate: "2026-07-30", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const now = Date.now();
    const payload = JSON.stringify([{ source: "unknown", template: "overflow", queries: 2, failures: 0, rows: 5, queryMs: 7 }]);
    await db.prepare("INSERT INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind("fixture", now, "process", "release", "deployment", payload, now + 86400000, 0, 0, 1, 1).run();
    await maintainDbTraffic({ DB: db as unknown as Env["DB"] } as Env, now, 1);
    const stored = await db.prepare("SELECT payload FROM db_traffic_hours").first<{ payload: string }>();
    expect(JSON.parse(stored!.payload)).toMatchObject({ truncated: true, sources: [{ source: "unknown", queries: 2, overflow: 2 }] });
  } finally { await mf.dispose(); }
}, 30000);


it("marks retained query totals as partial after a shape is evicted and reappears", async () => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response() } }", compatibilityDate: "2026-07-30", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const now = Date.now(); const currentHour = Math.floor(now / 3600000) * 3600000;
    const x = "q000000000000ffff";
    const row = (template: string, queries: number) => ({ source: "mizar", template, queries, failures: 0, rows: queries, queryMs: queries });
    const initial = JSON.stringify([...Array.from({ length: 90 }, (_, i) => row("q" + i.toString(16).padStart(16, "0"), 100)), row(x, 99)]);
    const insert = (id: string, at: number, payload: string) => db.prepare("INSERT INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id, at, "process", "release", "deployment", payload, now + 86400000, 0, 0, 1, 1);
    await db.batch([insert("first", currentHour - 3600000, initial), insert("second", currentHour, initial)]);
    const env = { DB: db as unknown as Env["DB"] } as Env;
    await maintainDbTraffic(env, now);
    await insert("third", now, JSON.stringify([row(x, 1000)])).run();
    await maintainDbTraffic(env, now);
    const result = await readDbTrafficHours(env, now, 24);
    expect(result.truncated).toBe(true);
    expect(result.totals.find(item => item.template === x)?.queries).toBe(1000);
    expect(result.sources.find(item => item.source === "mizar")?.queries).toBe(19198);
  } finally { await mf.dispose(); }
}, 30000);
