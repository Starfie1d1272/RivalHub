import { afterEach, expect, it, vi } from "vitest";
import { getObservabilityContext, withObservabilityContext } from "@/lib/observability/context";
import { getRuntimeHealthSnapshot, registerRuntimeHealthFlush, startRuntimeHealthSampling, stopRuntimeHealthSampling } from "@/lib/observability/runtime-health";
import { beginRuntimeResource, getRuntimeResourceSnapshot } from "@/lib/observability/runtime-resources";
import { logEvent } from "@/lib/observability/logger";

vi.mock("@/lib/observability/logger", () => ({ logEvent: vi.fn() }));
afterEach(() => { stopRuntimeHealthSampling(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("samples the application process once per idle minute across module graphs without creating a pool", async () => {
  vi.useFakeTimers();
  const contexts: unknown[] = [];
  vi.mocked(logEvent).mockImplementation(() => { contexts.push(getObservabilityContext()); return {} as ReturnType<typeof logEvent>; });
  const stop = startRuntimeHealthSampling();
  vi.resetModules();
  const other = await import("@/lib/observability/runtime-health");
  expect(other.startRuntimeHealthSampling()).toBe(stop);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(59_999);
  expect(logEvent).not.toHaveBeenCalled();
  withObservabilityContext({ requestId: "request-fixture" }, () => vi.advanceTimersByTime(1));
  expect(logEvent).toHaveBeenCalledTimes(3);
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "runtime.health.sample",
    safeContext: expect.objectContaining({ externalBytes: expect.any(Number), arrayBuffersBytes: expect.any(Number),
      eventLoopDelayP99Ms: expect.any(Number), eventLoopDelayMaxMs: expect.any(Number) }) }));
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "runtime.read.sample", operation: "bet.aggregate_fallback", safeContext: { count: 0 } }));
  expect(contexts.length).toBeGreaterThan(0);
  expect(contexts.every(value => Object.keys(value as object).length === 0)).toBe(true);
  stop(); stop();
  vi.advanceTimersByTime(120_000);
  expect(logEvent).toHaveBeenCalledTimes(3);
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

it("reads a process health snapshot", () => {
  const snapshot = getRuntimeHealthSnapshot()!;
  expect(snapshot.rssBytes).toBeGreaterThan(0);
  expect(snapshot.heapLimitBytes).toBeGreaterThan(0);
});


it("shares a fixed flush hook across graphs, replaces without leaking, and isolates failures", async () => {
  vi.useFakeTimers();
  const old = vi.fn();
  const removeOld = registerRuntimeHealthFlush("live_ingest", old);
  vi.resetModules();
  const other = await import("@/lib/observability/runtime-health");
  const latest = vi.fn(() => { throw new Error("fixture flush failure"); });
  const removeLatest = other.registerRuntimeHealthFlush("live_ingest", latest);
  removeOld();
  registerRuntimeHealthFlush("private-key" as never, old);
  startRuntimeHealthSampling();
  vi.advanceTimersByTime(60_000);
  expect(old).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "runtime.health.sample" }));
  stopRuntimeHealthSampling();
  vi.advanceTimersByTime(120_000);
  expect(latest).toHaveBeenCalledTimes(1);
  removeLatest(); removeLatest();
  startRuntimeHealthSampling();
  vi.advanceTimersByTime(60_000);
  expect(latest).toHaveBeenCalledTimes(1);
});
