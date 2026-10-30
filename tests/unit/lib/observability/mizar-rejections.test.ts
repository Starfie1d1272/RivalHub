import { afterEach, expect, it, vi } from "vitest";
import { getObservabilityContext, withObservabilityContext } from "@/lib/observability/context";
import { sanitizeSafeContext } from "@/lib/observability/redact";

vi.mock("@/lib/observability/logger", () => ({ logEvent: vi.fn() }));
import { logEvent } from "@/lib/observability/logger";

afterEach(() => {
  Reflect.deleteProperty(process, Symbol.for("rivalhub.mizar-rejections.v1"));
  vi.useRealTimers(); vi.clearAllMocks(); vi.resetModules();
});

it("bounds rejection logs and flushes the idle aggregate without request context", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const contexts: unknown[] = [];
  vi.mocked(logEvent).mockImplementation(() => { contexts.push(getObservabilityContext()); return {} as ReturnType<typeof logEvent>; });
  const { recordMizarReliableRejection } = await import("@/lib/observability/mizar-rejections");
  const { startRuntimeHealthSampling, stopRuntimeHealthSampling } = await import("@/lib/observability/runtime-health");
  withObservabilityContext({ requestId: "first" }, () => {
    for (let i = 0; i < 1000; i++) recordMizarReliableRejection("generation_fence", "domain", "first", { kind: "map_started", scopeHash: "0123456789abcdef", receivedCursor: 2, storedCursor: 1 });
  });
  expect(logEvent).toHaveBeenCalledTimes(1);
  expect(vi.mocked(logEvent).mock.calls[0]![0]).toMatchObject({ requestId: "first", safeContext: { reason: "generation_fence", kind: "map_started", scopeHash: "0123456789abcdef", receivedCursor: 2, storedCursor: 1 } });
  startRuntimeHealthSampling();
  withObservabilityContext({ requestId: "unrelated" }, () => vi.advanceTimersByTime(60_000));
  const logs = vi.mocked(logEvent).mock.calls.filter(([value]) => value.event === "mizar.reliable.reject");
  expect(logs).toHaveLength(2);
  expect(logs[1]![0].safeContext).toEqual({ reason: "generation_fence", firstAt: 1_000_000, lastAt: 1_000_000, count: 1000 });
  expect(contexts[1]).toEqual({});
  stopRuntimeHealthSampling();
});

it("restricts diagnostic fields to hashes and non-negative safe integers", () => {
  expect(sanitizeSafeContext({ scopeHash: "private payload", receivedCursor: "secret", storedCursor: -1, firstAt: Infinity, lastAt: 1.5 })).toEqual({});
  expect(sanitizeSafeContext({ scopeHash: "0123456789abcdef", receivedCursor: 3, storedCursor: 2, firstAt: 100, lastAt: 101, body: "private", credential: "secret" })).toEqual({ scopeHash: "0123456789abcdef", receivedCursor: 3, storedCursor: 2, firstAt: 100, lastAt: 101 });
});
