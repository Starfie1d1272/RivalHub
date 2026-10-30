import { afterEach, expect, it, vi } from "vitest";
import type { Env } from "../../../workers/telemetry/index";

const secret = "fixture-secret-".repeat(4);
const env = { DB_TRAFFIC_KEY: secret, ACCEPTING: "1", RETENTION_APPROVED: "1", DB: { prepare: () => { throw new Error("unexpected database access"); } } } as unknown as Env;
const now = 1_800_000_000_000;
function batch() {
  return { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", process: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", at: now, release: "release-marker", deployment: "deployment-marker", dropped: 0, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0, receivedBytes: 7, connections: 1, observedConnections: 1, remainingRxBytes: 0, remaining: { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, rows: [{ source: "match.page", template: "q1234567890abcdef", queries: 1, failures: 0, rows: 1, queryMs: 1.5, logicalRowJsonBytes: 2, logicalMeasuredQueries: 1, rxBytes: 7, skipReasons: { budget: 0, error: 0, unsupported_value: 0 } }] };
}
function request(body: string, authorized = true) { return new Request("https://fixture.invalid/v1/db-traffic", { method: "POST", headers: authorized ? { authorization: `Bearer ${secret}` } : {}, body }); }
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

it("reports only fixed validation categories and bounds repeated logs after authorization", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { ingestDbTraffic } = await import("../../../workers/telemetry/db-traffic");
  const value = batch(); value.rows[0].source = "private-source-marker";
  const raw = JSON.stringify(value);
  expect((await ingestDbTraffic(request(raw, false), env, now)).status).toBe(401);
  expect(warn).not.toHaveBeenCalled();
  expect((await ingestDbTraffic(request(raw), { ...env, ACCEPTING: "0" }, now)).status).toBe(503);
  expect(warn).not.toHaveBeenCalled();
  expect((await ingestDbTraffic(request(raw), env, now)).status).toBe(400);
  expect((await ingestDbTraffic(request(raw), env, now + 1)).status).toBe(400);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({ event: "db_traffic.reject", reason: "row_source", count: 1, invalidRows: 1 });
  expect((await ingestDbTraffic(request(raw), env, now + 60000)).status).toBe(400);
  expect(JSON.parse(String(warn.mock.calls[1][0]))).toEqual({ event: "db_traffic.reject", reason: "row_source", count: 2, invalidRows: 1 });
  const withSql = { ...batch(), extra: "select private_sql_marker from private_table" };
  expect((await ingestDbTraffic(request(JSON.stringify(withSql)), env, now)).status).toBe(400);
  expect(JSON.parse(String(warn.mock.lastCall?.[0])).reason).toBe("envelope_keys");
  const logs = JSON.stringify(warn.mock.calls);
  for (const forbidden of [secret, value.id, value.process, value.release, value.deployment, value.rows[0].source, value.rows[0].template, "private_sql_marker", "private_table"]) expect(logs).not.toContain(forbidden);
});

it("distinguishes timestamps, row measurements and byte conservation without accepting invalid data", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { ingestDbTraffic } = await import("../../../workers/telemetry/db-traffic");
  const cases: Array<[string, (value: ReturnType<typeof batch>) => void]> = [
    ["timestamp_old", v => { v.at = now - 86400001; }],
    ["timestamp_future", v => { v.at = now + 60001; }],
    ["row_skip_counts", v => { v.rows[0].skipReasons.budget = 1; }],
    ["remaining_sum", v => { v.remaining.partial = 1; }],
    ["received_sum", v => { v.receivedBytes = 8; }],
  ];
  for (const [reason, mutate] of cases) { const value = batch(); mutate(value); expect((await ingestDbTraffic(request(JSON.stringify(value)), env, now)).status).toBe(400); expect(JSON.parse(String(warn.mock.lastCall?.[0])).reason).toBe(reason); }
});
