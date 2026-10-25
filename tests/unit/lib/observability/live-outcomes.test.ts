import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { ROOT_CONTEXT, context } from "@opentelemetry/api";

vi.mock("@/lib/observability/logger", () => ({ logEvent: vi.fn() }));
import { logEvent } from "@/lib/observability/logger";

afterEach(() => {
  Reflect.deleteProperty(process, Symbol.for("rivalhub.live-outcome-window.v1"));
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules();
});

it("flushes the final idle window on a sampler tick, bounded and detached from request context", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const detached = vi.spyOn(context, "with");
  const { recordLiveIngestOutcome, recordLiveIngestStage, flushLiveIngestOutcomes } = await import("@/lib/observability/live-outcomes");
  recordLiveIngestOutcome("accepted", 100);
  recordLiveIngestOutcome("accepted", 300);
  recordLiveIngestOutcome("frame_expired", 900);
  recordLiveIngestStage("received");
  recordLiveIngestStage("unknown_send", 2000);
  recordLiveIngestOutcome("accepted", Number.NaN);
  recordLiveIngestOutcome("not-an-outcome" as never, 0);
  recordLiveIngestStage("not-a-stage" as never);
  flushLiveIngestOutcomes(59_999);
  expect(logEvent).not.toHaveBeenCalled();
  now = 60_000;
  flushLiveIngestOutcomes();
  expect(detached).toHaveBeenCalledWith(ROOT_CONTEXT, expect.any(Function));
  expect(vi.mocked(logEvent).mock.calls.map(([value]) => value)).toEqual([
    { event: "mizar.live.outcome_window", scope: "match", operation: "live.ingest", durationMs: 200,
      safeContext: { outcome: "accepted", count: 2, phase: "periodic_window", durationMs: 60_000 } },
    { event: "mizar.live.outcome_window", scope: "match", operation: "live.ingest", durationMs: 900,
      safeContext: { outcome: "frame_expired", count: 1, phase: "periodic_window", durationMs: 60_000 } },
    { event: "mizar.live.stage_window", scope: "match", operation: "live.ingest", durationMs: 0,
      safeContext: { outcome: "received", count: 1, phase: "periodic_window", durationMs: 60_000 } },
    { event: "mizar.live.stage_window", scope: "match", operation: "live.ingest", durationMs: 2000,
      safeContext: { outcome: "unknown_send", count: 1, phase: "periodic_window", durationMs: 60_000 } },
  ]);
  flushLiveIngestOutcomes(120_000);
  expect(logEvent).toHaveBeenCalledTimes(4);
});

it("shares bounded counters across module reloads without installing timers", async () => {
  vi.spyOn(performance, "now").mockReturnValue(0);
  const timer = vi.spyOn(globalThis, "setInterval");
  const first = await import("@/lib/observability/live-outcomes");
  first.recordLiveIngestStage("capacity", 5);
  vi.resetModules();
  const second = await import("@/lib/observability/live-outcomes");
  second.recordLiveIngestStage("capacity", 15);
  const otherView = runInNewContext('({ view: globalThis, window: process[Symbol.for("rivalhub.live-outcome-window.v1")] })', { process });
  expect(otherView.view).not.toBe(globalThis);
  expect(otherView.window).toBe(Reflect.get(process, Symbol.for("rivalhub.live-outcome-window.v1")));
  expect(otherView.window.stages.get("capacity").count).toBe(2);
  second.flushLiveIngestOutcomes(60_000);
  expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
    durationMs: 10, safeContext: expect.objectContaining({ outcome: "capacity", count: 2 }),
  }));
  expect(timer).not.toHaveBeenCalled();
});
