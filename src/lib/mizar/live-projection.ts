import type { LiveSnapshotV1 } from "./protocol";

export const PUBLIC_LIVE_MAX_BYTES = 192 * 1024;
export type LiveFreshness = "fresh" | "stale" | "unavailable";
export function liveFreshness(ageMs: number): LiveFreshness {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10_000) return "unavailable";
  return ageMs <= 3_000 ? "fresh" : "stale";
}

/** Producer/session identities stay at ingest. Delivery cursor is only ordering metadata. */
export function projectPublicLive(snapshot: LiveSnapshotV1, authorityRevision: number, receivedAt: string) {
  const projection = {
    schemaVersion: "rivalhub.public-live.v1" as const,
    matchId: snapshot.matchId, producedAt: snapshot.producedAt, receivedAt,
    delivery: { authorityRevision, generation: snapshot.cursor.programSourceGeneration, epoch: snapshot.cursor.mapEpoch, sequence: snapshot.cursor.runtimeSeq },
    series: snapshot.series, map: snapshot.map, roundPhase: snapshot.roundPhase, clock: snapshot.clock,
    teams: snapshot.teams, players: snapshot.players, roundHistory: snapshot.roundHistory,
    bomb: snapshot.bomb, radar: snapshot.radar, capability: snapshot.capability,
  };
  if (new TextEncoder().encode(JSON.stringify(projection)).length > PUBLIC_LIVE_MAX_BYTES) throw new Error("public_live_payload_too_large");
  return projection;
}
export type PublicLiveMatchProjection = ReturnType<typeof projectPublicLive>;

export function acceptsLiveDelivery(current: PublicLiveMatchProjection | null, next: PublicLiveMatchProjection, matchId: string): boolean {
  if (next.matchId !== matchId) return false;
  if (!current) return true;
  const a = current.delivery, b = next.delivery;
  if (b.authorityRevision !== a.authorityRevision) return b.authorityRevision > a.authorityRevision;
  if (b.generation !== a.generation) return b.generation > a.generation;
  if (b.epoch !== a.epoch) return b.epoch > a.epoch;
  // Same semantic cursor with a newly projected heartbeat refreshes freshness.
  return b.sequence > a.sequence || (b.sequence === a.sequence && next.producedAt > current.producedAt);
}
