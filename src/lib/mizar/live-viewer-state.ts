import { z } from "zod";
import { liveSnapshotV1Schema } from "./protocol";
import { PUBLIC_LIVE_MAX_BYTES, type PublicLiveMatchProjection } from "./live-projection";

const wire = liveSnapshotV1Schema.shape;
const ordinal = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const publicLiveSchema = z.strictObject({
  schemaVersion: z.literal("rivalhub.public-live.v1"),
  matchId: wire.matchId,
  producedAt: wire.producedAt,
  receivedAt: wire.producedAt,
  delivery: z.strictObject({ authorityRevision: ordinal, generation: ordinal, epoch: ordinal, sequence: ordinal }),
  series: wire.series, map: wire.map, roundPhase: wire.roundPhase, clock: wire.clock,
  teams: wire.teams, players: wire.players, roundHistory: wire.roundHistory,
  bomb: wire.bomb, radar: wire.radar, capability: wire.capability,
});

export type LiveFreshness = "fresh" | "stale" | "unavailable";
export interface LiveViewerState {
  snapshot: PublicLiveMatchProjection | null;
  /** Retained across reconnect/unavailable to reject delayed and duplicate delivery. */
  watermark: PublicLiveMatchProjection | null;
  receivedAt: number | null;
  revision: number;
}
export const initialLiveViewerState = (): LiveViewerState => ({ snapshot: null, watermark: null, receivedAt: null, revision: 0 });
export function liveFreshness(state: LiveViewerState, now: number): LiveFreshness {
  if (!state.snapshot || state.receivedAt === null) return "unavailable";
  const age = Math.max(0, now - state.receivedAt);
  return age <= 3000 ? "fresh" : age <= 10000 ? "stale" : "unavailable";
}
export function resetLiveViewer(state: LiveViewerState): LiveViewerState {
  return { ...state, snapshot: null, receivedAt: null, revision: state.revision + 1 };
}
export function liveBoundary(snapshot: PublicLiveMatchProjection): string {
  return JSON.stringify([snapshot.matchId, snapshot.delivery.authorityRevision, snapshot.delivery.generation, snapshot.delivery.epoch, snapshot.map.mapId, snapshot.map.name]);
}

/** Untrusted Broadcast input, latest-wins without a replay/baseline store. */
export function receivePublicLive(state: LiveViewerState, input: unknown, matchId: string, now: number): LiveViewerState {
  let serialized: string;
  try { serialized = JSON.stringify(input); } catch { return state; }
  if (!serialized || new TextEncoder().encode(serialized).length > PUBLIC_LIVE_MAX_BYTES) return state;
  const parsed = publicLiveSchema.safeParse(input);
  if (!parsed.success) return state;
  const next = parsed.data;
  if (next.matchId !== matchId || !next.capability.telemetryFresh || !next.capability.contextFresh || next.capability.identity !== "matched" || !next.capability.lineupComplete || !next.capability.canonicalTeams) return state;
  if (next.radar && (!next.capability.radarCurrent || next.radar.mapName !== next.map.name)) return state;
  if (next.roundHistory && next.series.currentMapOrder !== null && next.roundHistory.mapOrder !== next.series.currentMapOrder) return state;
  if (Date.parse(next.producedAt) > Date.parse(next.receivedAt) + 30000 || Date.parse(next.receivedAt) - Date.parse(next.producedAt) > 10000) return state;
  const previous = state.watermark;
  if (previous) {
    // Each outer boundary owns the inner counters; a newer authority may reset all of them.
    for (const key of ["authorityRevision", "generation", "epoch", "sequence"] as const) {
      if (next.delivery[key] < previous.delivery[key]) return state;
      if (next.delivery[key] > previous.delivery[key]) break;
    }
    // Same gameplay sequence is legal for a newly produced heartbeat, never for a replay.
    if (Date.parse(next.receivedAt) <= Date.parse(previous.receivedAt) || Date.parse(next.producedAt) <= Date.parse(previous.producedAt)) return state;
  }
  const changed = previous !== null && liveBoundary(previous) !== liveBoundary(next);
  return { snapshot: next, watermark: next, receivedAt: now, revision: state.revision + Number(changed) };
}

/** Stop at the exact freshness boundary, independent of delayed timer callbacks. */
export function liveClockSeconds(state: LiveViewerState, now: number): number | null {
  const snapshot = state.snapshot;
  const remaining = snapshot?.clock?.remainingSeconds;
  if (remaining == null || state.receivedAt === null || liveFreshness(state, now) === "unavailable") return null;
  const running = ["live", "freezetime", "bomb", "defuse"].includes(snapshot?.clock?.phase ?? "") && snapshot?.roundPhase !== "paused";
  const elapsed = running ? Math.min(3000, Math.max(0, now - state.receivedAt)) / 1000 : 0;
  return Math.max(0, remaining - elapsed);
}
