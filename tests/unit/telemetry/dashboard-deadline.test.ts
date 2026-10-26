import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { LongWindowSummary } from "@/lib/telemetry/long-window-contract";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), get: vi.fn(), destroyAgent: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: mocks.authorize }));
vi.mock("node:https", () => ({ Agent: class { destroy = mocks.destroyAgent; }, get: mocks.get }));
vi.mock("server-only", () => ({}));
import { getLongWindowSummary, getTelemetryAnalysis, getTelemetryHistory } from "@/lib/telemetry/dashboard";

type Request = EventEmitter & { destroy: ReturnType<typeof vi.fn> };
type Response = EventEmitter & { statusCode: number; destroy: ReturnType<typeof vi.fn> };
const calls: { at: number; signal: AbortSignal; request?: Request; response?: Response }[] = [];
let behavior: "ready" | "never" | "hanging" | "oversized";
let delay: number;
let serial = 0;
let fetchMock: ReturnType<typeof vi.spyOn>;
const cancelBody = vi.fn();
function payload() {
  const range = { from: Date.now() - 10000, to: Date.now() };
  return JSON.stringify({ generatedAt: Date.now(), validUntil: Date.now() + 60000,
    completionBasis: "observed_not_matured", requestedRange: range, effectiveRange: range, coveredRanges: [range], source: "history+tail+raw_edges",
    coverage: { status: "complete", segments: [], pendingTailBatches: 0, tailBudgetTruncated: false, metricGroupsTruncated: false, rawBudgetTruncated: false, retentionUnknown: false, seriesOmitted: false },
    counts: { views: 1, operations: 0, success: 0, rejected: 0, unknown: 0, pending: 0, taskStarts: 0, taskComplete: 0, taskExposure: null, errors: 0 },
    distinctSessions: null, distinctAccounts: null, metrics: [], unsupportedDimensions: [] } satisfies LongWindowSummary);
}
const input = () => ({ release: `deadline-${++serial}` });
async function untilRequest(count = 1) { await vi.waitFor(() => expect(calls).toHaveLength(count)); }
async function advanceTo(ms: number) { await vi.advanceTimersByTimeAsync(Math.max(0, calls[0].at + ms - Date.now())); }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  calls.length = 0; behavior = "ready"; delay = 0;
  mocks.authorize.mockReset().mockResolvedValue({ userId: "fixture" });
  mocks.get.mockReset(); mocks.destroyAgent.mockClear(); cancelBody.mockReset();
  vi.stubEnv("PRODUCT_TELEMETRY_ADMIN_KEY", "local-only-deadline-key".repeat(3));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://receiver.invalid/v1/batches");
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
    const signal = init!.signal!; calls.push({ at: Date.now(), signal });
    return new Promise((resolve, reject) => {
      const respond = () => {
        if (behavior === "never") return;
        if (behavior === "hanging") resolve(new globalThis.Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel: cancelBody,
        })));
        else resolve(new globalThis.Response(behavior === "oversized" ? "x".repeat(1024 * 1024 + 1) : payload()));
      };
      const timer = delay ? setTimeout(respond, delay) : undefined;
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      if (!delay) respond();
    });
  });
  mocks.get.mockImplementation((_url: URL, options: { signal: AbortSignal }, callback: (response: IncomingMessage) => void) => {
    const request = new EventEmitter() as Request;
    request.destroy = vi.fn(error => { request.emit("error", error); return request; });
    const call: (typeof calls)[number] = { at: Date.now(), signal: options.signal, request }; calls.push(call);
    const respond = () => {
      if (behavior === "never") return;
      const response = new EventEmitter() as Response; response.statusCode = 200;
      response.destroy = vi.fn(error => { if (error) response.emit("error", error); return response; });
      call.response = response; callback(response as unknown as IncomingMessage);
      response.emit("data", Buffer.from(behavior === "oversized" ? "x".repeat(1024 * 1024 + 1) : behavior === "hanging" ? "{" : payload()));
      if (behavior !== "hanging") response.emit("end");
    };
    if (delay) setTimeout(respond, delay); else queueMicrotask(respond);
    return request as unknown as ClientRequest;
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

for (const transport of ["direct", "proxy"] as const) describe(transport, () => {
  beforeEach(() => vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", transport === "proxy" ? "http://proxy.invalid:7890" : ""));
  it("allows 5.7s, coalesces requests, caches success and still authorizes every caller", async () => {
    delay = 5700; const query = input();
    const first = getLongWindowSummary(query); const joined = getLongWindowSummary(query);
    await untilRequest(); await advanceTo(5700);
    expect((await first).status).toBe("ready"); expect((await joined).status).toBe("ready");
    expect(calls[0].signal.aborted).toBe(false);
    expect((await getLongWindowSummary(query)).status).toBe("ready"); expect(calls).toHaveLength(1);
    mocks.authorize.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(getLongWindowSummary(query)).rejects.toThrow("FORBIDDEN"); expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(transport === "direct" ? fetchMock : mocks.get).toHaveBeenCalledTimes(1);
  });
  it("aborts at 15s, releases all four in-flight slots, does not cache failure and permits a new request", async () => {
    behavior = "never"; const queries = Array.from({ length: 4 }, input);
    const active = queries.map(query => getLongWindowSummary(query));
    await untilRequest(4);
    expect(await getLongWindowSummary(input())).toEqual({ status: "unavailable" }); expect(calls).toHaveLength(4);
    await advanceTo(14999); expect(calls.every(c => !c.signal.aborted)).toBe(true);
    await advanceTo(15000); expect(await Promise.all(active)).toEqual(Array.from({ length: 4 }, () => ({ status: "unavailable" })));
    expect(calls.every(c => c.signal.aborted)).toBe(true);
    if (transport === "proxy") expect(calls.every(c => c.request!.destroy.mock.calls.length === 1)).toBe(true);
    behavior = "ready";
    expect((await Promise.all(queries.map(query => getLongWindowSummary(query)))).every(result => result.status === "ready")).toBe(true);
    expect(calls).toHaveLength(8);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses the original total deadline when headers arrive at 5.7s but response body hangs", async () => {
    behavior = "hanging"; delay = 5700; const query = input(); const result = getLongWindowSummary(query);
    await untilRequest(); await advanceTo(5700); await advanceTo(14999);
    expect(calls[0].signal.aborted).toBe(false);
    await advanceTo(15000); expect(await result).toEqual({ status: "unavailable" });
    expect(calls[0].signal.aborted).toBe(true);
    if (transport === "proxy") { expect(calls[0].request!.destroy).toHaveBeenCalledOnce(); expect(calls[0].response!.destroy).toHaveBeenCalledOnce(); }
    else expect(cancelBody).toHaveBeenCalledOnce();
    behavior = "ready"; delay = 0;
    expect((await getLongWindowSummary(query)).status).toBe("ready"); expect(calls).toHaveLength(2);
  });
  it.each([getTelemetryAnalysis, getTelemetryHistory])("keeps the short query 5s deadline", async query => {
    behavior = "never"; const result = query({}); await untilRequest(); await advanceTo(4999);
    expect(calls[0].signal.aborted).toBe(false); await advanceTo(5000);
    expect(await result).toEqual({ status: "unavailable" }); expect(calls[0].signal.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });
  it("retains the 1MiB response limit and does not cache an oversized failure", async () => {
    behavior = "oversized"; const query = input(); expect(await getLongWindowSummary(query)).toEqual({ status: "unavailable" });
    behavior = "ready"; expect((await getLongWindowSummary(query)).status).toBe("ready"); expect(calls).toHaveLength(2);
  });
});
