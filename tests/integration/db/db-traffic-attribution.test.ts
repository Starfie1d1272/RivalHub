import { Client, Query, type ClientConfig } from "pg";
import { expect, it, vi } from "vitest";
import { DatabasePool } from "@/db/pool";
import { flushDbTraffic, queryShape, withDbTrafficSource } from "@/lib/observability/db-traffic";
import { localDatabaseUrl } from "./harness/database";

type TrafficRow = { source: string; template: string; queries: number; rxBytes: number; logicalMeasuredQueries: number; skipReasons: { budget: number; unsupported_value: number; error: number } };
type TrafficBatch = { at: number; receivedBytes: number; remainingRxBytes: number; remaining: Record<string, number>; rows: TrafficRow[]; dropped: number; droppedReceivedBytes: number; unconfirmedReceivedBytes: number; unconfirmedBatches: number };

// Exercises the installed driver and a real loopback PostgreSQL, including a frame
// split at a sampler boundary. No SQL or payload values are sent to telemetry.
it("conserves received protocol bytes across owners, errors, timeouts and a split flush", async () => {
  const oldEndpoint = process.env.PRODUCT_TELEMETRY_ENDPOINT;
  const oldKey = process.env.DB_TRAFFIC_KEY;
  process.env.PRODUCT_TELEMETRY_ENDPOINT = "https://telemetry.invalid/v1/batches";
  process.env.DB_TRAFFIC_KEY = "fixture-key".repeat(4);
  const sent: TrafficBatch[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => {
    sent.push(JSON.parse(init.body)); return new Response(null, { status: 204 });
  }));
  const pool = new DatabasePool({ connectionString: localDatabaseUrl(), ssl: false, max: 2 });
  let raw = 0;
  const first = await pool.connect();
  const second = await pool.connect();
  let firstReleased = false, secondReleased = false;
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
    const beforeSplit = raw;
    // The driver still parses the actual bytes from PostgreSQL; only delivery of
    // one socket chunk is split, simulating a sampler flush and hour boundary.
    const socket = streamA as unknown as { emit: (event: string, ...args: unknown[]) => boolean };
    const originalEmit = socket.emit;
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    let split = false;
    socket.emit = function (event: string, ...args: unknown[]) {
      const chunk = args[0];
      if (!split && event === "data" && Buffer.isBuffer(chunk) && chunk.length > 3) {
        split = true;
        const firstResult = Reflect.apply(originalEmit, this, [event, chunk.subarray(0, 3)]);
        flushDbTraffic();
        clock.mockReturnValue((Math.floor(now / 3600000) + 1) * 3600000 + 10);
        Reflect.apply(originalEmit, this, [event, chunk.subarray(3)]);
        return firstResult;
      }
      return Reflect.apply(originalEmit, this, [event, ...args]);
    };
    try { await withDbTrafficSource("dak", () => first.query("select repeat('z', 5000) as split_value")); }
    finally { socket.emit = originalEmit; }
    expect(split).toBe(true);
    // A pending asynchronous send may need another sampler tick to advance FIFO.
    for (let i = 0; i < 4; i++) { flushDbTraffic(); await new Promise(resolve => setImmediate(resolve)); }
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(3));
    clock.mockRestore();
    const splitBatches = sent.slice(1);
    const splitBytes = raw - beforeSplit;
    expect(splitBatches.reduce((sum, item) => sum + item.receivedBytes, 0)).toBe(splitBytes);
    expect(splitBatches[0].remaining.partial).toBe(3);
    expect(Math.floor(splitBatches[0].at / 3600000)).not.toBe(Math.floor(splitBatches.at(-1)!.at / 3600000));
    for (const item of splitBatches) {
      const assigned = item.rows.reduce((sum, row) => sum + row.rxBytes, 0);
      expect(item.receivedBytes).toBe(assigned + item.remainingRxBytes);
      expect(item.remainingRxBytes).toBe(Object.values(item.remaining).reduce((sum, n) => sum + n, 0));
    }
    // A failed or lost ACK retries the identical payload and batch ID; the
    // Worker deduplication test independently covers an already accepted ID.
    const attempts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => {
      attempts.push(init.body);
      if (attempts.length === 1) throw new Error("fixture lost acknowledgement");
      return new Response(null, { status: 204 });
    }));
    await withDbTrafficSource("mizar", () => first.query("select 3 as retry_fixture"));
    flushDbTraffic();
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    await new Promise(resolve => setImmediate(resolve));
    flushDbTraffic();
    await vi.waitFor(() => expect(attempts).toHaveLength(2));
    expect(attempts[1]).toBe(attempts[0]);
    first.release(); firstReleased = true;
    console.log("DB_RX_EVIDENCE", JSON.stringify({ receivedBytes: batch.receivedBytes, attributed, remaining: batch.remaining, sources: Object.fromEntries([...new Set(batch.rows.map(row => row.source))].map(source => [source, batch.rows.filter(row => row.source === source).reduce((n, row) => n + row.rxBytes, 0)])), difference: batch.receivedBytes - attributed - batch.remainingRxBytes, dropped: batch.dropped, splitBytes, splitBatches: splitBatches.map(item => ({ at: item.at, receivedBytes: item.receivedBytes, attributed: item.rows.reduce((n, row) => n + row.rxBytes, 0), remaining: item.remaining })) }));
  } finally {
    if (!firstReleased) first.release(true);
    if (!secondReleased) second.release(true);
    await pool.end();
    if (oldEndpoint === undefined) delete process.env.PRODUCT_TELEMETRY_ENDPOINT; else process.env.PRODUCT_TELEMETRY_ENDPOINT = oldEndpoint;
    if (oldKey === undefined) delete process.env.DB_TRAFFIC_KEY; else process.env.DB_TRAFFIC_KEY = oldKey;
    vi.unstubAllGlobals();
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
