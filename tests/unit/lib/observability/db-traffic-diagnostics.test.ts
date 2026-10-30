import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { flushDbTraffic, recordDbTraffic } from "@/lib/observability/db-traffic";

const host = process as unknown as Record<symbol, unknown>;
const trafficSlot = Symbol.for("rivalhub.db-traffic.v3");
const diagnosticSlot = Symbol.for("rivalhub.db-traffic.send-diagnostic.v1");
let root: string | undefined;
async function setup() {
  delete host[trafficSlot]; delete host[diagnosticSlot];
  root = await mkdtemp(join(tmpdir(), "traffic-diagnostic-"));
  vi.stubEnv("DB_TRAFFIC_KEY", "private-test-key-".repeat(3));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", "");
  vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
}
afterEach(async () => { delete host[trafficSlot]; delete host[diagnosticSlot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

it("reports a fixed failure without exposing payload, credentials or exception text", async () => {
  await setup(); const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const send = vi.fn(async () => { throw new Error("private-error-marker"); }); vi.stubGlobal("fetch", send);
  recordDbTraffic("match.page", "q1234567890abcdef", 1, 1, false); flushDbTraffic();
  await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  await vi.waitFor(() => expect((host[trafficSlot] as { sending: boolean }).sending).toBe(false));
  expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ event: "db_traffic.send_failure", httpStatus: null });
  const logs = JSON.stringify(warn.mock.calls);
  for (const forbidden of ["private-error-marker", "private-test-key", "match.page", "q1234567890abcdef"]) expect(logs).not.toContain(forbidden);
});

it("does not send or log when traffic collection is disabled", async () => {
  await setup(); vi.stubEnv("RIVALHUB_RUNTIME_HEALTH_ENABLED", "0");
  const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const send = vi.fn(); vi.stubGlobal("fetch", send);
  recordDbTraffic("match.page", "unknown", 1, 1, false); flushDbTraffic();
  expect(send).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
});
