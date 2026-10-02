import "server-only";

import { trace } from "@opentelemetry/api";

/** Sampled diagnostic estimate, never a substitute for Supabase's wire-byte billing. */
export function recordStatsProjectionRead(rows: readonly unknown[], unavailableMaps: number): void {
  const span = trace.getActiveSpan();
  if (!span?.isRecording()) return;
  try {
    span.setAttribute("rivalhub.stats.projection_rows", rows.length);
    span.setAttribute("rivalhub.stats.projection_json_bytes", Buffer.byteLength(JSON.stringify(rows), "utf8"));
    span.setAttribute("rivalhub.stats.unavailable_maps", unavailableMaps);
  } catch {
    // Diagnostics cannot fail the public read and never emit source data.
  }
}
