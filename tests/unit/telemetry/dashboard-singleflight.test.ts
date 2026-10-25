import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { analyzeTelemetry } from "@/lib/telemetry/analysis-model";
import { analysisDefaults, parseAnalysisQuery } from "@/lib/telemetry/analysis-query";
import { getTelemetryAnalysis } from "@/lib/telemetry/dashboard";

const { requireSuperAdmin } = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin }));
vi.mock("server-only", () => ({}));

let server: Server;
let requests: { url: URL; response: ServerResponse }[];
const nativeFetch = globalThis.fetch;
beforeEach(async () => {
  requests = [];
  requireSuperAdmin.mockReset().mockResolvedValue({ userId: "fixture" });
  vi.stubEnv("PRODUCT_TELEMETRY_ADMIN_KEY", "fixture-only-query-key".repeat(3));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://receiver.invalid/v1/batches");
  vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", "");
  server = createServer((request, response) => {
    requests.push({ url: new URL(request.url!, "http://fixture.invalid"), response });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture listener unavailable");
  // Test-only routing to a real loopback upstream. Production validates HTTPS;
  // this is concurrency evidence, not a TLS or authentication integration test.
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(String(input));
    return nativeFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  });
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function respond(index: number, status = 200, pad = false) {
  const { url, response } = requests[index];
  const query = parseAnalysisQuery(Object.fromEntries(url.searchParams))!;
  const now = Date.now();
  const batches = query.session.startsWith("a") ? 11 : query.session.startsWith("b") ? 22 : 0;
  const data = analyzeTelemetry({ capturedAt: now, batches, bytes: 0, oldest: now, events: [], metricIds: [], usage: { usage: [], expiredBatches: 0, budget: { batches: 5000, bytes: 8388608 } }, truncated: false, validUntil: now + 60000 }, query.filters, query.session);
  if (pad) data.product.releases = Array.from({ length: 2500 }, (_, i) => ({ release: String(i).padEnd(230, "x"), basis: "client" as const, reports: 1 }));
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(data));
}

it("coalesces ten simultaneous normalized misses into one actual upstream request", async () => {
  const calls = Array.from({ length: 10 }, (_, i) => getTelemetryAnalysis(i % 2 ? { release: "singleflight-ten" } : { session: "", hours: analysisDefaults.hours, release: "singleflight-ten", route: "" }));
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  expect(requireSuperAdmin).toHaveBeenCalledTimes(10);
  expect(fetch).toHaveBeenCalledTimes(1);
  respond(0);
  expect((await Promise.all(calls)).every(result => result.status === "ready")).toBe(true);
  expect(requests).toHaveLength(1);
  expect((await getTelemetryAnalysis({ release: "singleflight-ten" })).status).toBe("ready");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("clears failed pending work so the next authorized query retries", async () => {
  const first = getTelemetryAnalysis({ release: "singleflight-retry" });
  const joined = getTelemetryAnalysis({ release: "singleflight-retry" });
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  respond(0, 503);
  expect(await first).toEqual({ status: "unavailable" });
  expect(await joined).toEqual({ status: "unavailable" });
  const retry = getTelemetryAnalysis({ release: "singleflight-retry" });
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  respond(1);
  expect((await retry).status).toBe("ready");
});

it("keeps concurrent diagnostic sessions isolated in pending work and cache", async () => {
  const a = getTelemetryAnalysis({ release: "singleflight-session", session: "a".repeat(32) });
  const b = getTelemetryAnalysis({ release: "singleflight-session", session: "b".repeat(32) });
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  respond(0); respond(1);
  const results = await Promise.all([a, b]);
  expect(results.map(result => result.status === "ready" ? result.data.meta.batches : null)).toEqual([11, 22]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("rejects revoked authorization before joining pending work or reusing cache", async () => {
  const first = getTelemetryAnalysis({ release: "singleflight-revoke" });
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  requireSuperAdmin.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(getTelemetryAnalysis({ release: "singleflight-revoke" })).rejects.toThrow("FORBIDDEN");
  respond(0); expect((await first).status).toBe("ready");
  await expect(getTelemetryAnalysis({ release: "singleflight-revoke" })).rejects.toThrow("FORBIDDEN");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("bounds distinct pending queries while still joining an admitted key", async () => {
  const calls = Array.from({ length: 4 }, (_, i) => getTelemetryAnalysis({ release: `singleflight-bound-${i}` }));
  await vi.waitFor(() => expect(requests).toHaveLength(4));
  expect(await getTelemetryAnalysis({ release: "singleflight-bound-overflow" })).toEqual({ status: "unavailable" });
  const joined = getTelemetryAnalysis({ release: "singleflight-bound-0" });
  for (let i = 0; i < 4; i++) respond(i);
  expect((await Promise.all([...calls, joined])).every(result => result.status === "ready")).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(4);
});


it("evicts by encoded resident bytes and gives callers independently parsed cached data", async () => {
  for (let i = 0; i < 4; i++) {
    const loading = getTelemetryAnalysis({ release: `resident-bytes-${i}` });
    await vi.waitFor(() => expect(requests).toHaveLength(i + 1));
    respond(i, 200, true);
    const loaded = await loading;
    expect(loaded.status).toBe("ready");
    if (loaded.status === "ready") loaded.data.product.releases.length = 0;
  }
  // Four ~700 KiB objects fit the entry-count bound but exceed the 2 MiB byte bound.
  const cached = await getTelemetryAnalysis({ release: "resident-bytes-3" });
  expect(cached.status).toBe("ready");
  if (cached.status === "ready") expect(cached.data.product.releases).toHaveLength(2500);
  expect(requests).toHaveLength(4);
  const evicted = getTelemetryAnalysis({ release: "resident-bytes-0" });
  await vi.waitFor(() => expect(requests).toHaveLength(5)); respond(4);
  expect((await evicted).status).toBe("ready");
});
