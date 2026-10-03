import "server-only";
import { performance } from "node:perf_hooks";
import type { LiveSnapshotV1 } from "./protocol";

// Resource protection only; never an authorization or cross-instance state owner.
export const LIVE_REQUEST_LIMIT = 2;
const pending = new Map<string, number>();
const active = new Set<string>();
const DEMAND_LIMIT = 256;
const DEMAND_TTL_MS = 1500;
/** Demand tickets contain no frame, promise or authority. Rejected frames are discarded.
 * A recurring source retains its place until a subsequent fresh request takes a turn.
 * With N recurring keys, two permits and bounded work, each gets a turn in finitely
 * many releases. A silent source can reserve capacity for at most 1.5 seconds.
 */
export function tryAdmitLiveRequest(key: string): (() => void) | null {
  const now = performance.now();
  for (const [candidate, seen] of pending) {
    if (now - seen >= DEMAND_TTL_MS) pending.delete(candidate);
  }
  if (active.has(key)) return null;
  if (!pending.has(key) && pending.size >= DEMAND_LIMIT) return null;
  pending.set(key, now); // Map.set preserves an existing ticket's position.
  const free = LIVE_REQUEST_LIMIT - active.size;
  if ([...pending.keys()].indexOf(key) >= free) return null;
  pending.delete(key);
  active.add(key);
  let released = false;
  return () => {
    if (!released) { released = true; active.delete(key); }
  };
}

// Two bounded body readers take no DB connection. Auth and broadcasting
// share the two fair permits, leaving a third DB connection for other work.
// FIFO here only covers body ingress, never authentication or slow broadcasts. Waiting requests expire
// within the existing 500ms freshness budget; no parsed snapshot is queued.
const INGRESS_WAIT_LIMIT = 256;
let ingressActive = 0;
const ingressWaiters = new Set<() => void>();
export async function admitLiveIngress(): Promise<(() => void) | null> {
  if (ingressActive >= LIVE_REQUEST_LIMIT) {
    if (ingressWaiters.size >= INGRESS_WAIT_LIMIT) return null;
    const admitted = await new Promise<boolean>(resolve => {
      const enter = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { ingressWaiters.delete(enter); resolve(false); }, 500);
      ingressWaiters.add(enter);
    });
    if (!admitted) return null;
  } else ingressActive++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = ingressWaiters.values().next().value;
    if (next) { ingressWaiters.delete(next); next(); }
    else ingressActive--;
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
