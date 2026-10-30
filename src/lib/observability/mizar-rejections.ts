import { logEvent } from "./logger";
import { withoutObservabilityContext } from "./context";
import { registerRuntimeHealthFlush } from "./runtime-health";
import type { ReliableReason } from "@/lib/mizar/rejection";

type Reason = ReliableReason | "auth_failed" | "other";
type Phase = "auth" | "read" | "validate" | "domain" | "revalidation";
type Details = { kind: string; scopeHash: string; receivedCursor?: number; storedCursor?: number };
type Window = { firstAt: number; lastAt: number; count: number };
const slot = Symbol.for("rivalhub.mizar-rejections.v1");
const host = process as unknown as Record<symbol, Map<Reason, Window> | undefined>;
const windows = host[slot] ??= new Map<Reason, Window>();

/** Fixed reason buckets bound memory and log volume even for unauthenticated floods. */
export function recordMizarReliableRejection(reason: Reason, phase: Phase, requestId: string, details?: Details): void {
  try {
    const now = Date.now();
    const previous = windows.get(reason);
    if (previous && now - previous.firstAt < 60_000) {
      previous.lastAt = now;
      previous.count = Math.min(previous.count + 1, Number.MAX_SAFE_INTEGER);
      return;
    }
    if (previous) flushWindow(reason, previous);
    windows.set(reason, { firstAt: now, lastAt: now, count: 1 });
    logEvent({ event: "mizar.reliable.reject", scope: "mizar", operation: "reliable", requestId, safeContext: { reason, phase, count: 1, ...details } });
  } catch { /* Best effort diagnostics must not change the HTTP response. */ }
}

function flushWindow(reason: Reason, window: Window): void {
  if (window.count > 1) withoutObservabilityContext(() => logEvent({
    event: "mizar.reliable.reject", scope: "mizar", operation: "reliable", safeContext: { reason, firstAt: window.firstAt, lastAt: window.lastAt, count: window.count },
  }));
}

export function flushMizarReliableRejections(now = Date.now()): void {
  try {
    for (const [reason, window] of windows) if (now - window.firstAt >= 60_000) {
      windows.delete(reason);
      flushWindow(reason, window);
    }
  } catch { /* Open windows can be lost on log failure or process exit. */ }
}

registerRuntimeHealthFlush("mizar_reliable_reject", () => flushMizarReliableRejections());
