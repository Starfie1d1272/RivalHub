import type { LiveSnapshotV1 } from "./protocol";

/** Hard bound for one public live payload; the browser never receives more. */
export const PUBLIC_LIVE_MAX_BYTES = 192 * 1024;

/**
 * Public projection of a validated LiveSnapshot. Producer/session identities and the
 * delivery cursor stay at ingest; viewers only receive presentation facts plus the
 * authority revision that owns them.
 */
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
