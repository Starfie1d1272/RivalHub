import { afterEach, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { DB_SOURCES, type DbTrafficSource, digestDbTraffic } from "@/lib/observability/db-traffic-contract";

const adapter = vi.hoisted(() => ({ hooks: undefined as undefined | { raw(bytes: number): void; attribute(owner: { source: DbTrafficSource; template: string } | "async", bytes: number): void } }));
vi.mock("@/lib/observability/pg-traffic-adapter", () => ({ observePgTraffic: (_client: unknown, hooks: typeof adapter.hooks) => { adapter.hooks = hooks; return true; }, settlePgTraffic: () => {} }));
import { observeDbStream, recordDbTraffic, flushDbTraffic } from "@/lib/observability/db-traffic";

const slot = Symbol.for("rivalhub.db-traffic.v3");
type Row = { source: DbTrafficSource; template: string; queries: number; failures: number; rows: number; queryMs: number; logicalRowJsonBytes: number; logicalMeasuredQueries: number; rxBytes: number; skipReasons: { budget: number; unsupported_value: number; error: number } };
type State = { rows: Map<string, Row>; shapeScores: Map<string, number>; receivedBytes: number; remaining: { async: number }; sealing?: { body: string }; sending: boolean; delivery: Promise<unknown>; deliveryStarted: boolean; diskNextAttemptAt?: number };
const state = () => (process as unknown as Record<symbol, State>)[slot];
const shape = (n: number) => `q${n.toString(16).padStart(16, "0")}`;
function setup() {
  delete (process as unknown as Record<symbol, unknown>)[slot];
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-key".repeat(4)); vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  observeDbStream({ once: () => {} } as unknown as PoolClient);
}
function bytes(source: DbTrafficSource, template: string, value: number) { adapter.hooks!.raw(value); adapter.hooks!.attribute({ source, template }, value); }
afterEach(() => { delete (process as unknown as Record<symbol, unknown>)[slot]; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("preserves independent per-source totals as late and repeated shapes compete", () => {
  setup();
  const oracle = new Map<DbTrafficSource, { queries: number; failures: number; rows: number; queryMs: number; logicalRowJsonBytes: number; logicalMeasuredQueries: number; rxBytes: number; budget: number; unsupported_value: number; error: number }>();
  for (let i = 0; i < 180; i++) {
    const source = DB_SOURCES[i % DB_SOURCES.length]; const template = shape(i % 53); const value = i < 40 ? 1 : i % 7 + 2;
    const expected = oracle.get(source) ?? { queries: 0, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0, rxBytes: 0, budget: 0, unsupported_value: 0, error: 0 };
    bytes(source, template, value); expected.rxBytes += value;
    const reason = (["budget", "unsupported_value", "error"] as const)[i % 3]; const measured = i % 4 === 0;
    recordDbTraffic(source, template, 2, 0.125, i % 5 === 0, measured ? 7 : undefined, measured ? undefined : reason);
    expected.queries++; expected.failures += Number(i % 5 === 0); expected.rows += 2; expected.queryMs += 0.125;
    if (measured) { expected.logicalRowJsonBytes += 7; expected.logicalMeasuredQueries++; } else expected[reason]++;
    oracle.set(source, expected);
  }
  adapter.hooks!.raw(11); adapter.hooks!.attribute("async", 11);
  const rows = [...state().rows.values()];
  expect(state().shapeScores.size).toBeLessThanOrEqual(40); expect(rows.filter(row => row.template !== "overflow")).toHaveLength(40);
  expect(rows.filter(row => row.template === "overflow").length).toBeLessThanOrEqual(DB_SOURCES.length);
  for (const [source, expected] of oracle) {
    const actual = { queries: 0, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0, rxBytes: 0, budget: 0, unsupported_value: 0, error: 0 };
    for (const row of rows.filter(row => row.source === source)) {
      for (const key of ["queries", "failures", "rows", "queryMs", "logicalRowJsonBytes", "logicalMeasuredQueries", "rxBytes"] as const) actual[key] += row[key];
      for (const key of ["budget", "unsupported_value", "error"] as const) actual[key] += row.skipReasons[key];
      expect(row.failures).toBeLessThanOrEqual(row.queries); expect(row.logicalMeasuredQueries + Object.values(row.skipReasons).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(row.queries);
    }
    expect(actual).toEqual(expected);
  }
  expect(rows.reduce((sum, row) => sum + row.rxBytes, state().remaining.async)).toBe(state().receivedBytes);
});

it("freezes replacement while seal is pending and retries the identical body before resetting scores", async () => {
  setup(); for (let i = 0; i < 40; i++) { bytes("mizar", shape(i), 1); recordDbTraffic("mizar", shape(i), 1, 0.1, false, 5); }
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); const bodies: string[] = [];
  const seal = vi.fn(async (body: string) => { bodies.push(body); if (bodies.length === 1) { await held; throw new Error("disk failure"); } });
  state().delivery = Promise.resolve({ start: async () => {}, prune: async () => {}, seal, drain: async () => {} }); state().deliveryStarted = true;
  flushDbTraffic(); await vi.waitFor(() => expect(seal).toHaveBeenCalledTimes(1));
  const original = state().sealing!.body; const digest = await digestDbTraffic(JSON.parse(original));
  bytes("dak", shape(50), 1000); recordDbTraffic("dak", shape(50), 1, 0.1, true, undefined, "error"); bytes("mizar", shape(0), 3);
  expect(state().rows.get(`dak:overflow`)?.rxBytes).toBe(1000); expect(state().rows.has(`dak:${shape(50)}`)).toBe(false);
  expect(state().sealing!.body).toBe(original); release(); await vi.waitFor(() => expect(state().sending).toBe(false));
  expect(state().sealing!.body).toBe(original); expect(state().receivedBytes).toBe(1043);
  state().diskNextAttemptAt = 0; flushDbTraffic(); await vi.waitFor(() => expect(seal.mock.calls.length).toBeGreaterThanOrEqual(3));
  expect(bodies[1]).toBe(original); expect(await digestDbTraffic(JSON.parse(bodies[1]))).toBe(digest);
  await vi.waitFor(() => expect(state().sending).toBe(false));
  const all = bodies.map(body => JSON.parse(body));
  expect(all[0].id).toBe(all[1].id);
  expect(all[0].receivedBytes).toBe(40);
  expect(all[2].receivedBytes).toBe(1003);
  expect(all[2].rows.reduce((sum: number, row: Row) => sum + row.rxBytes, 0)).toBe(1003);
  expect(state().shapeScores.size).toBe(0);
  for (let i = 0; i < 40; i++) bytes("mizar", shape(i), 1);
  for (let i = 0; i < 10; i++) bytes("dak", shape(50), 100);
  expect(state().rows.get(`dak:${shape(50)}`)?.rxBytes).toBe(1000);
});

it("bounds named rows and one overflow per source below the body gate", () => {
  setup();
  for (let i = 0; i < 40; i++) { bytes("mizar", shape(i), 1); recordDbTraffic("mizar", shape(i), 1, 0.123456789012345, false, 1); }
  for (const [i, source] of DB_SOURCES.entries()) recordDbTraffic(source, shape(100 + i), 1, 0.123456789012345, true, undefined, "budget");
  const rows = [...state().rows.values()];
  expect(rows).toHaveLength(40 + DB_SOURCES.length);
  expect(Buffer.byteLength(JSON.stringify({ id: crypto.randomUUID(), process: crypto.randomUUID(), at: Date.now(), release: "x".repeat(80), deployment: "x".repeat(80), dropped: 0, receivedBytes: 40, connections: 1, observedConnections: 1, rows, remainingRxBytes: 0, remaining: { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0 }))).toBeLessThan(40000);
});

it("shares lazy ranking with another module graph and initializes existing rows", async () => {
  setup();
  bytes("mizar", shape(0), 50);
  delete (state() as Partial<State>).shapeScores;
  vi.resetModules();
  const other = await import("@/lib/observability/db-traffic");
  other.recordDbTraffic("mizar", shape(0), 1, 0.1, false, 1);
  expect(state().shapeScores.get(`mizar:${shape(0)}`)).toBe(50);
  for (let i = 1; i < 40; i++) bytes("mizar", shape(i), 1);
  bytes("dak", shape(100), 500);
  expect(state().rows.get(`dak:${shape(100)}`)?.rxBytes).toBe(500);
  expect(state().rows.get(`mizar:${shape(0)}`)?.rxBytes).toBe(50);
  expect(state().shapeScores.size).toBe(40);
});
