import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getObservabilityContext, withObservabilityContext } from "@/lib/observability/context";
import { sanitizeSafeContext } from "@/lib/observability/redact";

vi.mock("@/lib/observability/logger", () => ({ logEvent: vi.fn(), tryLogEvent: vi.fn() }));
import { logEvent, tryLogEvent } from "@/lib/observability/logger";

beforeEach(() => vi.mocked(tryLogEvent).mockReturnValue(true));

afterEach(() => {
  Reflect.deleteProperty(process, Symbol.for("rivalhub.mizar-rejections.v1"));
  vi.useRealTimers(); vi.clearAllMocks(); vi.resetModules();
});

it("bounds rejection logs and flushes the idle aggregate without request context", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const contexts: unknown[] = [];
  vi.mocked(tryLogEvent).mockImplementation(() => { contexts.push(getObservabilityContext()); return true; });
  vi.mocked(logEvent).mockImplementation(() => { contexts.push(getObservabilityContext()); return {} as ReturnType<typeof logEvent>; });
  const { recordMizarReliableRejection } = await import("@/lib/observability/mizar-rejections");
  const { startRuntimeHealthSampling, stopRuntimeHealthSampling } = await import("@/lib/observability/runtime-health");
  withObservabilityContext({ requestId: "first" }, () => {
    for (let i = 0; i < 1000; i++) recordMizarReliableRejection("generation_fence", "domain", "first", { kind: "map_started", scopeHash: "0123456789abcdef", receivedCursor: 2, storedCursor: 1 });
  });
  expect(tryLogEvent).toHaveBeenCalledTimes(1);
  expect(logEvent).not.toHaveBeenCalled();
  expect(vi.mocked(tryLogEvent).mock.calls[0]![0]).toMatchObject({ requestId: "first", safeContext: { reason: "generation_fence", kind: "map_started", scopeHash: "0123456789abcdef", receivedCursor: 2, storedCursor: 1 } });
  startRuntimeHealthSampling();
  withObservabilityContext({ requestId: "unrelated" }, () => vi.advanceTimersByTime(60_000));
  const logs = vi.mocked(logEvent).mock.calls.filter(([value]) => value.event === "mizar.reliable.reject");
  expect(logs).toHaveLength(1);
  expect(logs[0]![0].safeContext).toEqual({ reason: "generation_fence", firstAt: 1_000_000, lastAt: 1_000_000, count: 1000 });
  expect(contexts[1]).toEqual({});
  stopRuntimeHealthSampling();
});

it("restricts diagnostic fields to hashes and non-negative safe integers", () => {
  expect(sanitizeSafeContext({ scopeHash: "private payload", receivedCursor: "secret", storedCursor: -1, firstAt: Infinity, lastAt: 1.5 })).toEqual({});
  expect(sanitizeSafeContext({ scopeHash: "0123456789abcdef", receivedCursor: 3, storedCursor: 2, firstAt: 100, lastAt: 101, body: "private", credential: "secret" })).toEqual({ scopeHash: "0123456789abcdef", receivedCursor: 3, storedCursor: 2, firstAt: 100, lastAt: 101 });
});

it("does not copy an untrusted request-id header into a rejection log or response", async () => {
  const { withMizarRequest } = await import("@/lib/mizar/http");
  const { ReliableRejection } = await import("@/lib/mizar/rejection");
  const { ErrorCode } = await import("@/lib/errors");
  const request = new Request("http://localhost/api/mizar/reliable", { headers: { "x-request-id": "secret-credential-marker" } });
  const response = await withMizarRequest(request, "/api/mizar/[operation]", "reliable", async diagnostics => {
    diagnostics.phase = "domain";
    throw new ReliableRejection(ErrorCode.VALIDATION_FAILED, "事件已过期。", "sequence_stale");
  });
  const body = await response.json();
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(body)).not.toContain("secret-credential-marker");
  const log = vi.mocked(tryLogEvent).mock.calls.find(([value]) => value.event === "mizar.reliable.reject")![0];
  expect(log.requestId).toBe(body.requestId);
  expect(JSON.stringify(log)).not.toContain("secret-credential-marker");
});


it("returns an id only for the logged request, never for another scope or failed writes", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const { withMizarRequest } = await import("@/lib/mizar/http");
  const { ReliableRejection } = await import("@/lib/mizar/rejection");
  const { ErrorCode } = await import("@/lib/errors");
  const reject = async (scopeHash: string) => {
    const response = await withMizarRequest(new Request("http://localhost/api/mizar/reliable"), "/api/mizar/[operation]", "reliable", async diagnostics => {
      diagnostics.phase = "domain";
      throw new ReliableRejection(ErrorCode.VALIDATION_FAILED, "对局数据已过期，请刷新数据源。", "generation_fence", { kind: "map_started", scopeHash });
    });
    expect(response.status).toBe(400);
    return response.json();
  };
  const first = await reject("aaaaaaaaaaaaaaaa");
  const second = await reject("bbbbbbbbbbbbbbbb");
  expect(first).toMatchObject({ code: "VALIDATION_FAILED", reason: "generation_fence", recovery: "reconcile", requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(second).toEqual({ code: first.code, error: first.error, reason: first.reason, recovery: first.recovery });
  expect(tryLogEvent).toHaveBeenCalledTimes(1);
  expect(vi.mocked(tryLogEvent).mock.calls[0]![0]).toMatchObject({ requestId: first.requestId, safeContext: { scopeHash: "aaaaaaaaaaaaaaaa" } });
  vi.setSystemTime(1_060_000);
  vi.mocked(tryLogEvent).mockReturnValue(false);
  const failedWrite = await reject("bbbbbbbbbbbbbbbb");
  expect(failedWrite).toEqual({ code: first.code, error: first.error, reason: first.reason, recovery: first.recovery });
  expect(tryLogEvent).toHaveBeenCalledTimes(2);
});
