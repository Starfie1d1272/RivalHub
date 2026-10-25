import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { logEvent } from "./logger";

const OUTCOMES = ["accepted", "frame_expired", "contended", "delivery_dropped", "broadcast_unavailable", "rejected", "error"] as const;
export type LiveIngestOutcome = typeof OUTCOMES[number];
const STAGES = ["received", "admitted", "authorized", "send_success", "expired", "capacity", "contended", "unknown_send"] as const;
export type LiveIngestStage = typeof STAGES[number];
type Totals = { count: number; duration: number };
type WindowState = { start: number; outcomes: Map<LiveIngestOutcome, Totals>; stages: Map<LiveIngestStage, Totals> };
const KEY = Symbol.for("rivalhub.live-outcome-window.v1");
const processState = globalThis as typeof globalThis & { [KEY]?: WindowState };
const state = processState[KEY] ??= { start: performance.now(), outcomes: new Map(), stages: new Map() };

function record<K extends string>(counts: Map<K, Totals>, key: K, durationMs: number): void {
  const value = counts.get(key) ?? { count: 0, duration: 0 };
  value.count++;
  value.duration += Math.min(durationMs, 3_600_000);
  counts.set(key, value);
}

/** Existing ingest result denominator; stages are separate, overlapping milestones. */
export function recordLiveIngestOutcome(outcome: LiveIngestOutcome, durationMs: number): void {
  try {
    if (!OUTCOMES.includes(outcome) || !Number.isFinite(durationMs) || durationMs < 0) return;
    flushLiveIngestOutcomes();
    record(state.outcomes, outcome, durationMs);
  } catch { /* Observation cannot alter frame delivery. */ }
}

/** Fixed categories only; never retain a frame, credential, source or request context. */
export function recordLiveIngestStage(stage: LiveIngestStage, durationMs = 0): void {
  try {
    if (!STAGES.includes(stage) || !Number.isFinite(durationMs) || durationMs < 0) return;
    flushLiveIngestOutcomes();
    record(state.stages, stage, durationMs);
  } catch { /* Observation cannot alter frame delivery. */ }
}

/** Called by the process sampler, including idle ticks. SIGKILL can lose the open window. */
export function flushLiveIngestOutcomes(now = performance.now()): void {
  try {
    if (!Number.isFinite(now) || now - state.start < 60_000) return;
    const durationMs = Math.round(now - state.start);
    const outcomes = [...state.outcomes];
    const stages = [...state.stages];
    state.outcomes.clear();
    state.stages.clear();
    state.start = now;
    // Aggregates must not inherit whichever request/trace installed the sampler.
    context.with(ROOT_CONTEXT, () => {
      for (const [event, entries] of [
        ["mizar.live.outcome_window", outcomes],
        ["mizar.live.stage_window", stages],
      ] as const) for (const [outcome, value] of entries) logEvent({
        event, scope: "match", operation: "live.ingest", durationMs: value.duration / value.count,
        safeContext: { outcome, count: value.count, phase: "periodic_window", durationMs },
      });
    });
  } catch { /* Logging failure drops this window; never replay delivery. */ }
}
