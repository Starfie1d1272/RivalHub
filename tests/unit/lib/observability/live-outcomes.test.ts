import { afterEach, expect, it, vi } from "vitest";
import { ROOT_CONTEXT, context } from "@opentelemetry/api";

vi.mock("@/lib/observability/logger", () => ({ logEvent: vi.fn() }));
import { logEvent } from "@/lib/observability/logger";

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

it("emits bounded outcome counts and means only after an active minute, detached from request context", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const detached = vi.spyOn(context, "with");
  const { recordLiveIngestOutcome } = await import("@/lib/observability/live-outcomes");
  recordLiveIngestOutcome("accepted", 100);
  recordLiveIngestOutcome("accepted", 300);
  recordLiveIngestOutcome("frame_expired", 900);
  recordLiveIngestOutcome("accepted", Number.NaN);
  recordLiveIngestOutcome("not-an-outcome" as never, 0);
  expect(logEvent).not.toHaveBeenCalled();
  now = 60_001;
  recordLiveIngestOutcome("accepted", 200);
  expect(detached).toHaveBeenCalledWith(ROOT_CONTEXT, expect.any(Function));
  expect(vi.mocked(logEvent).mock.calls.map(([value]) => value)).toEqual([
    { event: "mizar.live.outcome_window", scope: "match", operation: "live.ingest", durationMs: 200,
      safeContext: { outcome: "accepted", count: 2, phase: "activity_window", durationMs: 60_001 } },
    { event: "mizar.live.outcome_window", scope: "match", operation: "live.ingest", durationMs: 900,
      safeContext: { outcome: "frame_expired", count: 1, phase: "activity_window", durationMs: 60_001 } },
  ]);
  now = 120_002;
  recordLiveIngestOutcome("error", 50);
  expect(logEvent).toHaveBeenLastCalledWith(expect.objectContaining({ durationMs: 200, safeContext: expect.objectContaining({ count: 1 }) }));
});
