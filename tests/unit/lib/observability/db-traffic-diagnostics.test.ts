import { afterEach, expect, it, vi } from "vitest";
import { flushDbTraffic, recordDbTraffic } from "@/lib/observability/db-traffic";

const host = process as unknown as Record<symbol, unknown>;
const trafficSlot = Symbol.for("rivalhub.db-traffic.v3");
const diagnosticSlot = Symbol.for("rivalhub.db-traffic.send-diagnostic.v1");
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function setup() {
  delete host[trafficSlot]; delete host[diagnosticSlot];
  vi.stubEnv("DB_TRAFFIC_KEY", "private-test-key-".repeat(3));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", "");
}
afterEach(() => { delete host[trafficSlot]; delete host[diagnosticSlot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("reports a bounded retry and queue summary without payload data or changing the queue", async () => {
  let now = 1_800_000_000_000; vi.spyOn(Date, "now").mockImplementation(() => now); setup();
  const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const bodies: string[] = []; let accept = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { bodies.push(init.body); return new Response(null, { status: accept ? 204 : 400 }); }));
  for (let i = 0; i < 8; i++) { recordDbTraffic("match.page", "q1234567890abcdef", 1, 1, false, 2); flushDbTraffic(); await settle(); }
  expect(warn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({ event: "db_traffic.send_failure", httpStatus: 400, retrySameHead: false, queued: 1, dropped: 0, suppressed: 0 });
  now += 60000; flushDbTraffic(); await settle();
  expect(JSON.parse(String(warn.mock.calls[1][0]))).toEqual({ event: "db_traffic.send_failure", httpStatus: 400, retrySameHead: true, queued: 5, dropped: 3, suppressed: 7 });
  expect(new Set(bodies).size).toBe(1);
  const logs = JSON.stringify(warn.mock.calls);
  for (const forbidden of ["private-test-key", "match.page", "q1234567890abcdef", JSON.parse(bodies[0]).id, JSON.parse(bodies[0]).process]) expect(logs).not.toContain(forbidden);
  accept = true;
  for (let i = 0; i < 8; i++) { flushDbTraffic(); await settle(); }
  expect(bodies.map(body => JSON.parse(body))).toContainEqual(expect.objectContaining({ dropped: 3 }));
});

it("reports a network failure without logging its message or claiming acknowledgement", async () => {
  setup(); const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const attempts: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { attempts.push(init.body); throw new Error("private-error-marker"); }));
  recordDbTraffic("match.page", "unknown", 1, 1, false); flushDbTraffic(); await settle(); flushDbTraffic(); await settle();
  expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ httpStatus: null, retrySameHead: false, queued: 1 });
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private-error-marker");
  expect(attempts[1]).toBe(attempts[0]);
});


it("does not send or log when traffic collection is disabled", async () => {
  setup(); vi.stubEnv("RIVALHUB_RUNTIME_HEALTH_ENABLED", "0");
  const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const send = vi.fn(); vi.stubGlobal("fetch", send);
  recordDbTraffic("match.page", "unknown", 1, 1, false); flushDbTraffic(); await settle();
  expect(send).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
});
