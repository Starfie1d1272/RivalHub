import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { expect, it, vi } from "vitest";
import { localDatabaseUrl } from "./harness/database";
import { trafficAck, trafficFixture } from "./harness/traffic";

it("settles an in-flight frame when a different module graph flushes", async () => {
  const cleanupTraffic = await trafficFixture();
  const realNow = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(realNow - 3600000);
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-key".repeat(4));
  vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", "");
  const sent: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { sent.push(init.body); return trafficAck(init.body); }));
  const { DatabasePool } = await import("@/db/pool");
  const producer = await import("@/lib/observability/db-traffic");
  vi.resetModules();
  const sampler = await import("@/lib/observability/db-traffic");
  const pool = new DatabasePool({ connectionString: localDatabaseUrl(), ssl: false, max: 1 });
  const client = await pool.connect();
  try {
    const socket = (client as unknown as { connection: { stream: { emit: (event: string, ...args: unknown[]) => boolean } } }).connection.stream;
    const originalEmit = socket.emit; let split = false;
    socket.emit = function(event: string, ...args: unknown[]) {
      const chunk = args[0];
      if (!split && event === "data" && Buffer.isBuffer(chunk) && chunk.length > 3) {
        split = true;
        const first = Reflect.apply(originalEmit, this, [event, chunk.subarray(0, 3)]);
        sampler.flushDbTraffic();
        clock.mockReturnValue(realNow);
        Reflect.apply(originalEmit, this, [event, chunk.subarray(3)]);
        return first;
      }
      return Reflect.apply(originalEmit, this, [event, ...args]);
    };
    try { await producer.withDbTrafficSource("match.page", () => client.query("select repeat('x', 5000) as fixture")); }
    finally { socket.emit = originalEmit; }
    expect(split).toBe(true);
    for (let i = 0; i < 4; i++) { sampler.flushDbTraffic(); await new Promise(resolve => setImmediate(resolve)); }
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2));
    const batches = sent.map(body => JSON.parse(body));
    console.log("CROSS_GRAPH_EVIDENCE", JSON.stringify(batches.map(batch => ({ received: batch.receivedBytes, sources: batch.rows.reduce((sum: number, row: {rxBytes:number}) => sum + row.rxBytes, 0), remaining: batch.remainingRxBytes, partial: batch.remaining.partial }))));
    const require = createRequire(import.meta.url);
    const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild") as { build(options: object): Promise<{ outputFiles: { text: string }[] }> };
    const built = await build({ entryPoints: ["workers/telemetry/index.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
    const bindings = { SIGNING_KEY: "fixture-signing-key".repeat(3), ADMIN_KEY: "fixture-admin-key".repeat(3), DB_TRAFFIC_KEY: "fixture-key".repeat(4), ALLOWED_ORIGIN: "https://rivalhub.invalid", ACCEPTING: "1", RETENTION_APPROVED: "1" };
    const mf = new Miniflare({ modules: true, script: built.outputFiles[0].text, compatibilityDate: "2026-07-30", bindings, d1Databases: ["DB"] });
    try {
      const db = await mf.getD1Database("DB");
      const schema = (await readFile("workers/telemetry/schema.sql", "utf8")).replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
      await db.batch(schema.map(sql => db.prepare(sql)));
      const statuses = [];
      for (const body of sent) {
        const batch = JSON.parse(body);
        expect(batch.receivedBytes).toBe(batch.rows.reduce((sum: number, row: {rxBytes:number}) => sum + row.rxBytes, batch.remainingRxBytes));
        const response = await mf.dispatchFetch("https://worker.invalid/v1/db-traffic", { method: "POST", headers: { authorization: `Bearer ${bindings.DB_TRAFFIC_KEY}` }, body });
        statuses.push(response.status);
      }
      expect(statuses.every(status => status === 204)).toBe(true);
      expect(batches[0].remaining.partial).toBe(3);
      expect(Math.floor(batches[0].at / 3600000)).not.toBe(Math.floor(batches[1].at / 3600000));
      expect(batches[1].rows.find((row: {source:string}) => row.source === "match.page")?.rxBytes).toBeGreaterThan(0);
    } finally { await mf.dispose(); }
  } finally {
    clock.mockRestore(); client.release(); await pool.end(); await cleanupTraffic(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules();
  }
}, 30000);
