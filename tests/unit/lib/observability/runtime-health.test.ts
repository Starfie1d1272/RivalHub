import { afterEach, expect, it, vi } from "vitest";
import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { getRuntimeHealthSnapshot, startRuntimeHealthSampling, stopRuntimeHealthSampling } from "@/lib/observability/runtime-health";
import { beginRuntimeResource, getRuntimeResourceSnapshot } from "@/lib/observability/runtime-resources";
import { sanitizeSafeContext } from "@/lib/observability/redact";
import { logEvent } from "@/lib/observability/logger";

vi.mock("@/lib/observability/logger", () => ({ logEvent: vi.fn() }));
afterEach(() => { stopRuntimeHealthSampling(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("samples the application process once per idle minute across module graphs without creating a pool", async () => {
  vi.useFakeTimers();
  const detached = vi.spyOn(context, "with");
  const stop = startRuntimeHealthSampling();
  vi.resetModules();
  const other = await import("@/lib/observability/runtime-health");
  expect(other.startRuntimeHealthSampling()).toBe(stop);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(59_999);
  expect(logEvent).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(logEvent).toHaveBeenCalledTimes(1);
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "runtime.health.sample",
    safeContext: expect.objectContaining({ externalBytes: expect.any(Number), arrayBuffersBytes: expect.any(Number),
      eventLoopDelayP99Ms: expect.any(Number), eventLoopDelayMaxMs: expect.any(Number) }) }));
  expect(detached).toHaveBeenCalledWith(ROOT_CONTEXT, expect.any(Function));
  stop(); stop();
  vi.advanceTimersByTime(120_000);
  expect(logEvent).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  other.startRuntimeHealthSampling();
  expect(vi.getTimerCount()).toBe(1);
});

it("keeps fixed resource names and counts overlapping work once, with detached snapshots", () => {
  const before = getRuntimeResourceSnapshot().find(x => x.name === "stats.public.fill")!;
  const finishA = beginRuntimeResource("stats.public.fill");
  const finishB = beginRuntimeResource("stats.public.fill");
  expect(getRuntimeResourceSnapshot().find(x => x.name === "stats.public.fill")).toMatchObject({ inFlight: 2, peak: 2 });
  finishA(); finishA(); finishB();
  const result = getRuntimeResourceSnapshot();
  expect(result.find(x => x.name === "stats.public.fill")).toMatchObject({ inFlight: 0, count: before.count + 2 });
  result[0].count = 12345;
  beginRuntimeResource("private-user-id" as never)();
  expect(getRuntimeResourceSnapshot()).toHaveLength(5);
  expect(getRuntimeResourceSnapshot()[0].count).not.toBe(12345);
});

it("retains only numeric resource diagnostics and rejects payloads through new keys", () => {
  const snapshot = getRuntimeHealthSnapshot()!;
  expect(snapshot.rssBytes).toBeGreaterThan(0);
  expect(snapshot.heapLimitBytes).toBeGreaterThan(0);
  const safe = sanitizeSafeContext({ ...snapshot, bucketLe1: 4, bucketGt1000: 2, waitingPeak: 3,
    totalMs: 50, inFlight: 2, peak: 3, requestBody: "private", nodeVersion: "private", maxMs: "https://private.invalid" });
  expect(safe).toMatchObject({ rssBytes: snapshot.rssBytes, externalBytes: snapshot.externalBytes,
    arrayBuffersBytes: snapshot.arrayBuffersBytes, bucketLe1: 4, bucketGt1000: 2, waitingPeak: 3, totalMs: 50, inFlight: 2, peak: 3 });
  expect(safe).not.toHaveProperty("requestBody");
  expect(safe).not.toHaveProperty("nodeVersion");
  expect(safe).not.toHaveProperty("maxMs");
  expect(sanitizeSafeContext({ rssBytes: Infinity, heapUsedBytes: -1, totalMs: "secret", peak: NaN })).toEqual({});
});
