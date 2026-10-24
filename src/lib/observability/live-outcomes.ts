import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { logEvent } from "./logger";

const OUTCOMES = ["accepted", "frame_expired", "contended", "delivery_dropped", "broadcast_unavailable", "rejected", "error"] as const;
export type LiveIngestOutcome = typeof OUTCOMES[number];
const counts = new Map<LiveIngestOutcome, { count: number; duration: number }>();
let windowStart = performance.now();

/** Activity-driven, process-local totals; the final idle window is not persisted. */
export function recordLiveIngestOutcome(outcome: LiveIngestOutcome, durationMs: number): void {
  try {
    if (!OUTCOMES.includes(outcome) || !Number.isFinite(durationMs) || durationMs < 0) return;
    const now = performance.now();
    if (now - windowStart >= 60_000) {
      // Aggregates must not inherit the request/trace that happened to flush them.
      context.with(ROOT_CONTEXT, () => {
        for (const [result, value] of counts) logEvent({
          event: "mizar.live.outcome_window", scope: "match", operation: "live.ingest",
          durationMs: value.duration / value.count,
          safeContext: { outcome: result, count: value.count, phase: "activity_window", durationMs: Math.round(now - windowStart) },
        });
      });
      counts.clear();
      windowStart = now;
    }
    const value = counts.get(outcome) ?? { count: 0, duration: 0 };
    value.count++;
    value.duration += Math.min(durationMs, 3_600_000);
    counts.set(outcome, value);
  } catch { /* Observation cannot alter frame delivery. */ }
}
