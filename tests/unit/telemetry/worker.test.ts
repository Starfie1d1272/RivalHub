import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { accountKey, signTicket } from "@/lib/telemetry/ticket";
import { maintain, type Env } from "../../../workers/telemetry/index";
import { DB_SOURCES } from "@/lib/observability/db-traffic-contract";
import { maintainDbTraffic, maintainDbTrafficQuality, readDbTrafficHours } from "../../../workers/telemetry/db-traffic-rollup";

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
    // Maximum producer cardinality and legal numeric values stay below ingress limit.
    const maximum = JSON.parse(body); maximum.id = crypto.randomUUID();
    maximum.release = "r".repeat(80); maximum.deployment = "d".repeat(80);
    maximum.dropped = 1000000; maximum.receivedBytes = 1e12; maximum.connections = 1000; maximum.observedConnections = 1000;
    const longest = [...DB_SOURCES].sort ( (a, b) => b.length - a.length )[0];
    const metric = (source: string, template: string) => ({ source, template, queries: 1e12, failures: 1e12, rows: 1e12, queryMs: 1e12, logicalRowJsonBytes: 1e12, logicalMeasuredQueries: 1e12 });
    maximum.rows = [...Array.from({ length: 40 }, (_, i) => metric(longest, "q" + i.toString(16).padStart(16, "0"))), ...DB_SOURCES.map(source => metric(source, "overflow"))];
    const maximumBody = JSON.stringify(maximum);
    expect(Buffer.byteLength(maximumBody)).toBeLessThanOrEqual(24000);
    expect((await mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body: maximumBody })).status).toBe(204);
    const newMaximum = { ...maximum, id: crypto.randomUUID(), receivedBytes: maximum.rows.length, remainingRxBytes: 0, remaining: { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, droppedReceivedBytes: 1e12, unconfirmedReceivedBytes: 1e12, unconfirmedBatches: 1000000, rows: maximum.rows.map((row: object) => ({ ...row, rxBytes: 1, skipReasons: { budget: 0, unsupported_value: 0, error: 0 } })) };
    const newMaximumBody = JSON.stringify(newMaximum);
    expect(Buffer.byteLength(newMaximumBody)).toBeLessThanOrEqual(40000);
    expect((await mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body: newMaximumBody })).status).toBe(204);
    await db.prepare("DELETE FROM db_traffic_batches WHERE id=?").bind(newMaximum.id).run();
    // Remove this independent fixture before checking the small mixed-version totals.
    await db.prepare("DELETE FROM db_traffic_batches WHERE id=?").bind(maximum.id).run();
    await db.prepare("DELETE FROM db_traffic_hours").run();
    await db.prepare("UPDATE db_traffic_batches SET processed=0").run();
    heavy.rows[20].logicalRowJsonBytes = 999999; heavy.rows[20].logicalMeasuredQueries = 1;
    // This shape was already ingested above; add a new versioned batch to an old hour.
    const mixed = JSON.parse(body); mixed.id = crypto.randomUUID(); mixed.receivedBytes = 0; mixed.dropped = 0;
    mixed.rows = [{ source: "context.absent", template: "qabcdef0123456789", queries: 2, failures: 0, rows: 1, queryMs: 1, logicalRowJsonBytes: 10, logicalMeasuredQueries: 1 }];
    expect((await mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body: JSON.stringify(mixed) })).status).toBe(204);
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
    expect(data).toMatchObject({ dropped: 2, receivedBytes: 123, offline: [offline], sources: expect.arrayContaining([expect.objectContaining({ queries: 2004, rows: 1000025, queryMs: 60032 }), expect.objectContaining({ queries: 2, logicalRowJsonBytes: 10, logicalMeasuredQueries: 1 })]) });
    expect(data.byTime[0].template).toBe("q0000000000000014");
    expect(data.byRows[0].template).toBe("q0000000000000014");
    const burst = JSON.parse(body); burst.id = crypto.randomUUID(); burst.dropped = 0; burst.receivedBytes = 0;
    burst.rows = Array.from({ length: 100 }, (_, i) => ({ source: "mizar", template: "q" + (1000 + i).toString(16).padStart(16, "0"), queries: 1, failures: 0, rows: 1, queryMs: 1 }));
    expect((await mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body: JSON.stringify(burst) })).status).toBe(204);
    const truncated = await mf.dispatchFetch("https://worker.invalid/admin/db-traffic", { headers: { authorization: `Bearer ${bindings.ADMIN_KEY}` } });
    const afterBurst = await truncated.json() as { truncated: boolean; sources: Array<{ queries: number }>; byRows: Array<{ template: string }> };
    expect(afterBurst.truncated).toBe(true);
    expect(afterBurst.sources.find(row => row.queries === 2104)?.queries).toBe(2104);
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
    const initial = JSON.stringify([...Array.from({ length: 120 }, (_, i) => row("q" + i.toString(16).padStart(16, "0"), 100)), row(x, 99)]);
    const insert = (id: string, at: number, payload: string) => db.prepare("INSERT INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id, at, "process", "release", "deployment", payload, now + 86400000, 0, 0, 1, 1);
    await db.batch([insert("first", currentHour - 3600000, initial), insert("second", currentHour, initial)]);
    const env = { DB: db as unknown as Env["DB"] } as Env;
    await maintainDbTraffic(env, now);
    await insert("third", now, JSON.stringify([row(x, 1000)])).run();
    await maintainDbTraffic(env, now);
    const result = await readDbTrafficHours(env, now, 24);
    expect(result.truncated).toBe(true);
    expect(result.totals.find(item => item.template === x)?.queries).toBe(1000);
    expect(result.sources.find(item => item.source === "mizar")?.queries).toBe(25198);
  } finally { await mf.dispose(); }
}, 30000);


it("retains a low-frequency byte leader through hourly truncation", async () => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response() } }", compatibilityDate: "2026-07-30", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const now = Date.now();
    const rows = Array.from({ length: 121 }, (_, i) => ({ source: "mizar", template: "q" + i.toString(16).padStart(16, "0"), queries: i === 120 ? 1 : 100, failures: 0, rows: i === 120 ? 1 : 100, queryMs: i === 120 ? 1 : 100, logicalRowJsonBytes: i === 120 ? 999999 : 1, logicalMeasuredQueries: 1 }));
    await db.prepare("INSERT INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind("fixture", now, "process", "release", "deployment", JSON.stringify(rows), now + 86400000, 0, 0, 1, 1).run();
    const env = { DB: db as unknown as Env["DB"] } as Env;
    await maintainDbTraffic(env, now);
    const result = await readDbTrafficHours(env, now, 24);
    expect(result.truncated).toBe(true);
    expect(result.byBytes[0]).toMatchObject({ template: "q0000000000000078", logicalRowJsonBytes: 999999 });
    expect(result.sources[0].logicalRowJsonBytes).toBe(1000119);
  } finally { await mf.dispose(); }
}, 30000);

it("keeps attributed bytes idempotent and scoped to one hour and deployment while identifying legacy gaps", async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: object): Promise<{ outputFiles: { text: string }[] }> };
  const built = await build({ entryPoints: ["workers/telemetry/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
  const bindings = { SIGNING_KEY: "fixture-signing-key".repeat(3), ADMIN_KEY: "fixture-admin-key".repeat(3), DB_TRAFFIC_KEY: "fixture-db-key".repeat(3), ALLOWED_ORIGIN: "https://rivalhub.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1" };
  const mf = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: "2026-07-30", bindings, d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const hour = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;
    const base = { id: crypto.randomUUID(), process: crypto.randomUUID(), at: hour + 1000, release: "v1", deployment: "d1", dropped: 1, droppedReceivedBytes: 50, unconfirmedReceivedBytes: 30, unconfirmedBatches: 1, receivedBytes: 125, connections: 1, observedConnections: 1, remainingRxBytes: 25, remaining: { async: 2, no_owner: 3, partial: 4, unsupported: 6, instrumentation: 10 }, rows: [{ source: "mizar", template: "q0000000000000001", queries: 0, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0, rxBytes: 100, skipReasons: { budget: 0, unsupported_value: 0, error: 0 } }] };
    const send = (body: unknown) => mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body: JSON.stringify(body) });
    expect((await Promise.all([send(base), send(base)])).map(r => r.status)).toEqual([204, 204]);
    const invalid = { ...base, id: crypto.randomUUID(), receivedBytes: 126 };
    expect((await send(invalid)).status).toBe(204);
    const isolated = await db.prepare("SELECT payload,reasons FROM db_traffic_receipts WHERE id=?").bind(invalid.id).first<{ payload: string; reasons: string }>();
    expect(JSON.parse(isolated!.payload)).toEqual(invalid);
    expect(JSON.parse(isolated!.reasons)).toEqual(["received_sum"]);
    expect(await db.prepare("SELECT id FROM db_traffic_batches WHERE id=?").bind(invalid.id).first()).toBeNull();
    const second = { ...base, id: crypto.randomUUID(), release: "v2", deployment: "d2", receivedBytes: 125 };
    expect((await send(second)).status).toBe(204);
    const legacy = { id: crypto.randomUUID(), process: crypto.randomUUID(), at: hour + 2000, release: "v1", deployment: "d1", dropped: 0, receivedBytes: 10, connections: 1, observedConnections: 1, rows: [{ source: "mizar", template: "q0000000000000001", queries: 1, failures: 0, rows: 1, queryMs: 1 }] };
    expect((await send(legacy)).status).toBe(204);
    await maintainDbTraffic({ ...bindings, DB: db as unknown as Env["DB"] }, Date.now());
    const response = await mf.dispatchFetch("https://worker.invalid/admin/db-traffic?hours=24", { headers: { authorization: `Bearer ${bindings.ADMIN_KEY}` } });
    const data = await response.json() as { windows: Array<{ hour: number; release: string; deployment: string; batches: number; receivedBytes: number; remainingRxBytes: number; rxComplete: boolean; logicalComplete: boolean; lossComplete: boolean; droppedReceivedBytes: number; unconfirmedReceivedBytes: number; unconfirmedBatches: number; sources: Array<{ source: string; queries: number; rxBytes: number }> }> };
    expect(data.windows).toHaveLength(2);
    const v1 = data.windows.find(w => w.release === "v1")!;
    const selectedResponse = await mf.dispatchFetch(`https://worker.invalid/admin/db-traffic?hours=24&hour=${hour}&release=v2&deployment=d2`, { headers: { authorization: `Bearer ${bindings.ADMIN_KEY}` } });
    const selectedData = await selectedResponse.json() as typeof data;
    const v2 = selectedData.windows.find(w => w.release === "v2")!;
    expect(v1).toMatchObject({ hour, deployment: "d1", batches: 2, receivedBytes: 135, remainingRxBytes: 25, rxComplete: false, logicalComplete: false, lossComplete: false, droppedReceivedBytes: 50, unconfirmedReceivedBytes: 30, unconfirmedBatches: 1, sources: [{ source: "mizar", queries: 1, rxBytes: 100 }] });
    expect(v2).toMatchObject({ hour, deployment: "d2", batches: 1, receivedBytes: 125, remainingRxBytes: 25, rxComplete: true, logicalComplete: true, lossComplete: true, droppedReceivedBytes: 50, unconfirmedReceivedBytes: 30, unconfirmedBatches: 1, sources: [{ source: "mizar", queries: 0, rxBytes: 100 }] });
    expect(v2.sources[0].rxBytes + v2.remainingRxBytes).toBe(v2.receivedBytes);
    const oldHour = hour - 3600000;
    await db.prepare("INSERT INTO db_traffic_hours(hour,version,payload,expires) VALUES(?,1,?,?)").bind(oldHour, JSON.stringify({ sources: [], shapes: [], releases: [], receivedBytes: 4, connections: 0, observedConnections: 0, dropped: 0, truncated: false }), Date.now() + 86400000).run();
    const withHistory = await mf.dispatchFetch("https://worker.invalid/admin/db-traffic?hours=24", { headers: { authorization: `Bearer ${bindings.ADMIN_KEY}` } });
    expect(await withHistory.json()).toMatchObject({ unscopedHours: [oldHour], lossComplete: false });
  } finally { await mf.dispose(); }
}, 30000);

it("quarantines unsafe relationships without poisoning later batches and detects ID conflicts", async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: object): Promise<{ outputFiles: { text: string }[] }> };
  const built = await build({ entryPoints: ["workers/telemetry/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
  const bindings = { SIGNING_KEY: "fixture-signing-key".repeat(3), ADMIN_KEY: "fixture-admin-key".repeat(3), ALLOWED_ORIGIN: "https://rivalhub.invalid", DB_TRAFFIC_KEY: "fixture-db-key".repeat(3), ACCEPTING: "1", RETENTION_APPROVED: "1" };
  const mf = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: "2026-07-30", bindings, d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const base = { id: crypto.randomUUID(), process: crypto.randomUUID(), at: Date.now(), release: "v1", deployment: "d1", dropped: 0, receivedBytes: 1, connections: 1, observedConnections: 1, remainingRxBytes: 0, remaining: { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, rows: [{ source: "mizar", template: "q0000000000000001", queries: 1, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 1, rxBytes: 1, skipReasons: { budget: 0, unsupported_value: 0, error: 0 } }] };
    const send = (body: unknown) => mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}`, "x-db-traffic-protocol": "2" }, body: JSON.stringify(body) });
    const bad = { ...base, observedConnections: 2, receivedBytes: 3, remainingRxBytes: 1, rows: [{ ...base.rows[0], failures: 2, logicalMeasuredQueries: 2, skipReasons: { ...base.rows[0].skipReasons, budget: 1 } }] };
    const isolated = await send(bad);
    expect(await isolated.json()).toMatchObject({ protocol: 2, id: bad.id, status: "quarantined" });
    const receipt = await db.prepare("SELECT payload,reasons FROM db_traffic_receipts WHERE id=?").bind(bad.id).first<{ payload: string; reasons: string }>();
    expect(JSON.parse(receipt!.payload)).toEqual(bad);
    expect(JSON.parse(receipt!.reasons)).toEqual(["observed_connections", "failures", "logical_measured_queries", "skip_sum", "remaining_sum", "received_sum"]);
    const quality = await db.prepare("SELECT payload FROM db_traffic_quality_hours").first<{ payload: string }>();
    expect(JSON.parse(quality!.payload)).toMatchObject({ scopes: [{ release: "v1", deployment: "d1", batches: 1 }] });
    await db.prepare("DELETE FROM db_traffic_quality_hours").run();
    await db.prepare("UPDATE db_traffic_receipts SET processed=0 WHERE id=?").bind(bad.id).run();
    await Promise.all([maintainDbTrafficQuality({ ...bindings, DB: db as unknown as Env["DB"] }, Date.now()), maintainDbTrafficQuality({ ...bindings, DB: db as unknown as Env["DB"] }, Date.now())]);
    const concurrentQuality = await db.prepare("SELECT payload FROM db_traffic_quality_hours").first<{ payload: string }>();
    expect(JSON.parse(concurrentQuality!.payload).scopes[0].batches).toBe(1);
    const illegal = { ...base, id: crypto.randomUUID(), extra: "private" };
    expect((await send(illegal)).status).toBe(400);
    expect(await db.prepare("SELECT id FROM db_traffic_receipts WHERE id=?").bind(illegal.id).first()).toBeNull();
    const good = Array.from({ length: 10 }, () => ({ ...base, id: crypto.randomUUID() }));
    for (const value of good) expect((await send(value)).status).toBe(200);
    expect(await db.prepare("SELECT count(*) AS n FROM db_traffic_batches").first()).toEqual({ n: 10 });
    const trusted = await db.prepare("SELECT payload FROM db_traffic_hours").first<{ payload: string }>();
    expect(JSON.parse(trusted!.payload).sources[0].queries).toBe(10);
    expect(await db.prepare("SELECT batches FROM db_traffic_usage").first()).toEqual({ batches: 11 });
    expect((await send(bad)).status).toBe(200);
    expect(await db.prepare("SELECT batches FROM db_traffic_usage").first()).toEqual({ batches: 11 });
    expect((await send({ ...bad, receivedBytes: 4 })).status).toBe(409);
    const sameId = crypto.randomUUID();
    const responses = await Promise.all([send({ ...base, id: sameId }), send({ ...base, id: sameId, receivedBytes: 2 })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const gap = { id: crypto.randomUUID(), process: base.process, release: "v1", deployment: "d1", reportedAt: Date.now(), start: base.at - 1000, end: base.at, reason: "overflow", certainty: "lost", batches: 1, receivedBytes: 42, truncated: false, coverageUnknownSince: null };
    const sendGap = () => mf.dispatchFetch("https://worker.invalid/v1/db-traffic-gap", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}`, "x-db-traffic-protocol": "2" }, body: JSON.stringify(gap) });
    expect((await sendGap()).status).toBe(200);
    expect((await sendGap()).status).toBe(200);
    expect(await db.prepare("SELECT count(*) AS n FROM db_traffic_receipts WHERE status='gap'").first()).toEqual({ n: 1 });
    const withGap = await db.prepare("SELECT payload FROM db_traffic_quality_hours").first<{ payload: string }>();
    expect(JSON.parse(withGap!.payload).scopes[0]).toMatchObject({ lostBatches: 1, lostBytes: 42 });
    expect(await db.prepare("SELECT batches FROM db_traffic_usage").first()).toEqual({ batches: 13 });
    await db.prepare("UPDATE db_traffic_usage SET batches=5000").run();
    expect((await send(bad)).status).toBe(200);
    const limited = await send({ ...base, id: crypto.randomUUID() });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-db-traffic-limit")).toBe("daily");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await db.prepare("SELECT batches FROM db_traffic_usage").first()).toEqual({ batches: 5000 });
  } finally { await mf.dispose(); }
}, 30000);

it("replays the same committed batch after an ACK is lost and the spool owner restarts", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { DbTrafficSpool } = await import("@/lib/observability/db-traffic-spool"); const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: object): Promise<{ outputFiles: { text: string }[] }> };
  const built = await build({ entryPoints: ["workers/telemetry/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
  const bindings = { SIGNING_KEY: "fixture-signing-key".repeat(3), ADMIN_KEY: "fixture-admin-key".repeat(3), ALLOWED_ORIGIN: "https://rivalhub.invalid", DB_TRAFFIC_KEY: "fixture-db-key".repeat(3), ACCEPTING: "1", RETENTION_APPROVED: "1" };
  const mf = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: "2026-07-30", bindings, d1Databases: ["DB"] });
  const root = await mkdtemp(join(tmpdir(), "traffic-d1-replay-"));
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
    await db.batch(schema.map(sql => db.prepare(sql)));
    const now = Date.now(); const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
    const batch = { id: crypto.randomUUID(), ...identity, at: now, dropped: 0, receivedBytes: 2, connections: 1, observedConnections: 1, rows: [{ source: "mizar", template: "q0000000000000001", queries: 1, failures: 0, rows: 1, queryMs: 1 }] };
    let spool = await DbTrafficSpool.open(root); let delivery = new DbTrafficDelivery(spool, identity);
    await delivery.seal(JSON.stringify(batch), now);
    const dispatch = (body: string) => mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}`, "x-db-traffic-protocol": "2" }, body });
    await delivery.drain(async item => { expect((await dispatch(item.body)).status).toBe(200); throw new Error("ACK lost"); }, () => now);
    expect(spool.snapshot().batches[0]).toMatchObject({ id: batch.id, attempted: true });
    spool.close(); spool = await DbTrafficSpool.open(root); delivery = new DbTrafficDelivery(spool, identity);
    await delivery.drain(async item => { const response = await dispatch(item.body); const ack = await response.json() as { id: string; digest: string; status: string }; return { ok: response.status === 200 && ack.id === item.id && ack.digest === item.digest && ack.status === "accepted", status: response.status, retryAfter: null, limit: null }; }, () => now + 600000);
    expect(spool.snapshot().batches).toHaveLength(0); spool.close();
    expect(await db.prepare("SELECT batches FROM db_traffic_usage").first()).toEqual({ batches: 1 });
    expect(await db.prepare("SELECT count(*) AS n FROM db_traffic_batches").first()).toEqual({ n: 1 });
    const rollup = await db.prepare("SELECT payload FROM db_traffic_hours").first<{ payload: string }>();
    expect(JSON.parse(rollup!.payload).sources[0].queries).toBe(1);
    const legacy = { ...batch, id: crypto.randomUUID(), at: now - 2 * 86400000 };
    await db.prepare("INSERT INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(legacy.id, legacy.at, legacy.process, legacy.release, legacy.deployment, JSON.stringify(legacy.rows), now + 86400000, legacy.dropped, legacy.receivedBytes, legacy.connections, legacy.observedConnections).run();
    const { ingestDbTraffic } = await import("../../../workers/telemetry/db-traffic");
    const legacyRequest = (value: unknown) => new Request("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}`, "x-db-traffic-protocol": "2" }, body: JSON.stringify(value) });
    const legacyEnv = { ...bindings, DB: db as unknown as Env["DB"] };
    expect((await ingestDbTraffic(legacyRequest(legacy), legacyEnv, now)).status).toBe(200);
    expect((await ingestDbTraffic(legacyRequest({ ...legacy, receivedBytes: 3 }), legacyEnv, now)).status).toBe(409);
    expect(await db.prepare("SELECT batches FROM db_traffic_usage").first()).toEqual({ batches: 1 });
    await db.batch([db.prepare("DELETE FROM db_traffic_batches"), db.prepare("DELETE FROM db_traffic_receipts"), db.prepare("DELETE FROM db_traffic_hours"), db.prepare("DELETE FROM db_traffic_quality_hours"), db.prepare("DELETE FROM db_traffic_usage")]);
    spool = await DbTrafficSpool.open(root); delivery = new DbTrafficDelivery(spool, identity);
    const bad = { ...batch, id: crypto.randomUUID(), rows: [{ ...batch.rows[0], failures: 2 }] };
    await delivery.seal(JSON.stringify(bad), now);
    for (let i = 0; i < 10; i++) await delivery.seal(JSON.stringify({ ...batch, id: crypto.randomUUID() }), now);
    const sendToD1 = async (item: { id: string; body: string; digest: string }) => {
      const response = await dispatch(item.body); const ack = await response.json() as { id: string; digest: string; status: string };
      return { ok: response.status === 200 && ack.id === item.id && ack.digest === item.digest && ["accepted", "quarantined"].includes(ack.status), status: response.status, retryAfter: null, limit: null };
    };
    await delivery.drain(sendToD1, () => now); await delivery.drain(sendToD1, () => now);
    expect(spool.snapshot().batches).toHaveLength(0); spool.close();
    expect(await db.prepare("SELECT count(*) AS n FROM db_traffic_batches").first()).toEqual({ n: 10 });
    expect(await db.prepare("SELECT count(*) AS n FROM db_traffic_receipts WHERE status='quarantined'").first()).toEqual({ n: 1 });
    const cleanRollup = await db.prepare("SELECT payload FROM db_traffic_hours").first<{ payload: string }>();
    expect(JSON.parse(cleanRollup!.payload).sources[0].queries).toBe(10);
    expect(await db.prepare("SELECT batches FROM db_traffic_usage").first()).toEqual({ batches: 11 });
  } finally { await mf.dispose(); await rm(root, { recursive: true, force: true }); }
}, 30000);
