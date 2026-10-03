import "server-only";
import { performance } from "node:perf_hooks";
import type { LiveSnapshotV1 } from "./protocol";

// Resource protection only; never an authorization or cross-instance state owner.
export const LIVE_REQUEST_LIMIT = 2;
let requests = 0;
export function tryAdmitLiveRequest(): (() => void) | null {
  if (requests >= LIVE_REQUEST_LIMIT) return null;
  requests++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      requests--;
    }
  };
}

const RECENT_LIMIT = 256;
const RECENT_TTL_MS = 10_000;
const recent = new Map<
  string,
  {
    identity: string;
    sequence: number;
    producedAt: number;
    attemptedAt: number;
    tokens: number;
  }
>();
/** Called only after fresh DB authorization, with the cross-instance LIVE lock held. */
export function admitLiveDelivery(
  snapshot: LiveSnapshotV1,
  revision: number,
): boolean {
  const now = performance.now();
  for (const [key, value] of recent)
    if (now - value.attemptedAt >= RECENT_TTL_MS) recent.delete(key);
  const identity = JSON.stringify([
    revision,
    snapshot.cursor.producerInstanceId,
    snapshot.cursor.liveSessionId,
    snapshot.cursor.programSourceGeneration,
    snapshot.cursor.mapEpoch,
  ]);
  const old = recent.get(snapshot.matchId);
  const sequence = snapshot.cursor.runtimeSeq;
  const producedAt = Date.parse(snapshot.producedAt);
  if (
    old?.identity === identity &&
    (sequence < old.sequence || producedAt <= old.producedAt)
  )
    return false;
  // Two-token burst absorbs arrival jitter from a legitimate 2 Hz producer;
  // sustained refill remains 2/s. A rigid 500ms receipt gap drops healthy frames.
  const available =
    old?.identity === identity
      ? Math.min(2, old.tokens + (now - old.attemptedAt) / 500)
      : 2;
  if (available < 1 || (!old && recent.size >= RECENT_LIMIT)) return false;
  recent.set(snapshot.matchId, {
    identity,
    sequence,
    producedAt,
    attemptedAt: now,
    tokens: available - 1,
  });
  return true;
}
