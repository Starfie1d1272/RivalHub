import { Client, Query, type ClientConfig } from "pg";
import { expect, it, vi } from "vitest";
import { DatabasePool } from "@/db/pool";
import { flushDbTraffic, queryShape, withDbTrafficSource } from "@/lib/observability/db-traffic";
import { localDatabaseUrl } from "./harness/database";
import { trafficAck, trafficFixture } from "./harness/traffic";

type TrafficRow = { source: string; template: string; queries: number; rxBytes: number; logicalMeasuredQueries: number; skipReasons: { budget: number; unsupported_value: number; error: number } };
type TrafficBatch = { receivedBytes: number; remainingRxBytes: number; remaining: Record<string, number>; rows: TrafficRow[]; dropped: number; droppedReceivedBytes: number; unconfirmedReceivedBytes: number; unconfirmedBatches: number };

// Exercises the installed driver and a real loopback PostgreSQL.
it("conserves received protocol bytes across owners, errors and timeouts", async () => {
  const cleanupTraffic = await trafficFixture();
  const oldEndpoint = process.env.PRODUCT_TELEMETRY_ENDPOINT;
  const oldKey = process.env.DB_TRAFFIC_KEY;
  process.env.PRODUCT_TELEMETRY_ENDPOINT = "https://telemetry.invalid/v1/batches";
  process.env.DB_TRAFFIC_KEY = "fixture-key".repeat(4);
  const sent: TrafficBatch[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => {
    sent.push(JSON.parse(init.body)); return trafficAck(init.body);
  }));
  // Keep the bytes sampled here in the same hour regardless of runner time.
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  const pool = new DatabasePool({ connectionString: localDatabaseUrl(), ssl: false, max: 2 });
  let raw = 0;
  const first = await pool.connect();
  const second = await pool.connect();
  let secondReleased = false;
  try {
    const streamA = (first as unknown as { connection: { stream: NodeJS.ReadableStream } }).connection.stream;
    const streamB = (second as unknown as { connection: { stream: NodeJS.ReadableStream } }).connection.stream;
    for (const stream of [streamA, streamB]) stream.on("data", (chunk: Buffer) => { raw += chunk.length; });
    const a = withDbTrafficSource("mizar", () => first.query("select pg_sleep(0.02), repeat('a', 2000) as value"));
    const b = withDbTrafficSource("dak", () => first.query("select repeat('b', 3000) as value"));
    const c = withDbTrafficSource("bet.fill", () => second.query("select repeat('c', 4000) as value"));
    await Promise.all([a, b, c]);
    await withDbTrafficSource("mizar", () => first.query("begin"));
    await expect(withDbTrafficSource("dak", () => first.query("select 1/0"))).rejects.toMatchObject({ code: "22012" });
    await withDbTrafficSource("mizar", () => first.query("rollback"));
    await withDbTrafficSource("bet.fill", () => first.query("select 1 where false"));
    await withDbTrafficSource("mizar", () => first.query("do $$ begin raise notice 'fixture'; end $$"));
    await withDbTrafficSource("mizar", () => first.query("set application_name = 'fixture'"));
    await withDbTrafficSource("mizar", () => first.query("listen traffic_fixture"));
    const notification = new Promise<void>(resolve => first.once("notification", () => resolve()));
    await withDbTrafficSource("bet.fill", () => second.query("select pg_notify('traffic_fixture', 'fixture')"));
    await notification;
    const custom = new Query("select 777 as custom_value");
    const customDone = new Promise<void>((resolve, reject) => { custom.once("end", () => resolve()); custom.once("error", reject); });
    withDbTrafficSource("dak", () => first.query(custom));
    await customDone;
    const large = "select repeat('x', 120000) || '' as value";
    await withDbTrafficSource("dak", () => second.query(large));
    const timedConfig = { text: "select pg_sleep(0.08), 1", query_timeout: 10 };
    await expect(withDbTrafficSource("mizar", () => first.query(timedConfig))).rejects.toThrow("Query read timeout");
    await new Promise(resolve => setTimeout(resolve, 130));
    await withDbTrafficSource("mizar", () => first.query("select 2"));
    for (let i = 0; i < 45; i++) await withDbTrafficSource("stats.platform", () => second.query(`select 1 as shape_${i}`));
    second.on("error", () => { /* The deliberate disconnect also emits a client error. */ });
    const interrupted = withDbTrafficSource("mizar", () => second.query("select pg_sleep(0.5) as interrupted"));
    setTimeout(() => (streamB as unknown as { destroy(): void }).destroy(), 10);
    await expect(interrupted).rejects.toThrow();
    second.release(true); secondReleased = true;
    flushDbTraffic();
    await vi.waitFor(() => expect(sent.length).toBe(1));
    const batch = sent[0];
    const attributed = batch.rows.reduce((sum, row) => sum + row.rxBytes, 0);
    expect(batch.receivedBytes).toBe(raw);
    expect(batch.receivedBytes).toBe(attributed + batch.remainingRxBytes);
    expect(batch.remainingRxBytes).toBe(Object.values(batch.remaining).reduce((sum, n) => sum + n, 0));
    for (const [source, sql, minimum] of [
      ["mizar", "select pg_sleep(0.02), repeat('a', 2000) as value", 2000],
      ["dak", "select repeat('b', 3000) as value", 3000],
      ["bet.fill", "select repeat('c', 4000) as value", 4000],
    ] as const) {
      const row = batch.rows.find(item => item.source === source && item.template === queryShape(sql));
      expect(row?.rxBytes).toBeGreaterThanOrEqual(minimum);
      expect(row?.rxBytes).toBeLessThan(minimum + 500);
    }
    expect(batch.rows.find(row => row.source === "mizar" && row.template === queryShape("select pg_sleep(0.08), 1"))?.rxBytes).toBeGreaterThan(0);
    expect(batch.rows.find(row => row.source === "dak" && row.template === queryShape(large))).toMatchObject({ logicalMeasuredQueries: 0, skipReasons: { budget: 1 } });
    expect(batch.rows.find(row => row.source === "dak" && row.template === queryShape("select 1/0"))?.rxBytes).toBeGreaterThan(0);
    expect(batch.remaining.async).toBeGreaterThan(0);
    expect(batch.remaining.unsupported).toBeGreaterThan(0);
    expect(batch.rows.find(row => row.source === "stats.platform" && row.template === "overflow")?.rxBytes).toBeGreaterThan(0);
    expect(batch).toMatchObject({ dropped: 0, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0 });
    console.log("DB_RX_EVIDENCE", JSON.stringify({ receivedBytes: batch.receivedBytes, attributed, remaining: batch.remaining, sources: Object.fromEntries([...new Set(batch.rows.map(row => row.source))].map(source => [source, batch.rows.filter(row => row.source === source).reduce((n, row) => n + row.rxBytes, 0)])), difference: batch.receivedBytes - attributed - batch.remainingRxBytes, dropped: batch.dropped }));
  } finally {
    first.release(true);
    if (!secondReleased) second.release(true);
    await pool.end();
    if (oldEndpoint === undefined) delete process.env.PRODUCT_TELEMETRY_ENDPOINT; else process.env.PRODUCT_TELEMETRY_ENDPOINT = oldEndpoint;
    if (oldKey === undefined) delete process.env.DB_TRAFFIC_KEY; else process.env.DB_TRAFFIC_KEY = oldKey;
    await cleanupTraffic(); vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
}, 15000);

// The early observer must not replace a caller-supplied pg Client's identity.
it("preserves a custom Client constructor, arguments and new.target", async () => {
  let actualTarget: unknown, actualConfig: string | ClientConfig | undefined;
  class CustomClient extends Client {
    constructor(config?: string | ClientConfig) {
      super(config);
      actualTarget = new.target;
      actualConfig = config;
    }
  }
  const pool = new DatabasePool({ Client: CustomClient, connectionString: localDatabaseUrl(), ssl: false, max: 1 });
  try {
    const client = await pool.connect();
    try {
      expect(client).toBeInstanceOf(CustomClient);
      expect(client.constructor).toBe(CustomClient);
      expect(actualTarget).toBe(CustomClient);
      expect(actualConfig).toMatchObject({ connectionString: localDatabaseUrl(), ssl: false, max: 1 });
      expect((await client.query("select 1 as n")).rows).toEqual([{ n: 1 }]);
    } finally { client.release(); }
  } finally { await pool.end(); }
}, 15000);
