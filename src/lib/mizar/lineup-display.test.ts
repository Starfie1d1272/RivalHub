import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/contracts/mizar-live-real-derived.json";
import { parseLiveSnapshotV1 } from "./protocol";
import { projectPublicLive } from "./live-projection";
import { parsePublicLiveProjection } from "./live-viewer-state";

// The browser is independently exposed to untrusted Broadcast messages. Its
// exception must not turn generic degraded/mismatch or partial rosters into LIVE.
describe("public observed lineup projection", () => {
  function frame() {
    const snapshot = parseLiveSnapshotV1(fixture.snapshot);
    snapshot.capability.identity = "degraded";
    snapshot.capability.lineupMismatchOnly = true;
    snapshot.players = snapshot.players.map((player, index) => ({ ...player, sourcePlayerId: `765611900000000${String(index).padStart(2, "0")}`, lineupEvidence: "current", side: index < 5 ? "CT" : "T" }));
    snapshot.players[0]!.identityEvidence = "canonical"; // A stale producer hint cannot link an unverified account.
    snapshot.radar!.players[0]!.sourcePlayerId = snapshot.players[0]!.sourcePlayerId;
    return projectPublicLive(snapshot, 1, snapshot.producedAt);
  }
  it("accepts a complete roster-only difference and removes temporary-account identity links from table and radar", () => {
    const value = frame();
    expect(parsePublicLiveProjection(value, value.matchId)).not.toBeNull();
    expect(value.players[0]!.canonicalPlayerId).toBeNull();
    expect(value.radar!.players[0]!.canonicalPlayerId).toBeNull();
  });
  it("rejects unqualified degraded/mismatch, stale, ambiguous or incomplete input", () => {
    const value = frame();
    for (const capability of [
      { ...value.capability, lineupMismatchOnly: undefined },
      { ...value.capability, identity: "mismatch" },
      { ...value.capability, telemetryFresh: false },
      { ...value.capability, canonicalTeams: false },
    ]) expect(parsePublicLiveProjection({ ...value, capability }, value.matchId)).toBeNull();
    expect(parsePublicLiveProjection({ ...value, players: value.players.slice(0, 9) }, value.matchId)).toBeNull();
    expect(parsePublicLiveProjection({ ...value, players: [...value.players.slice(0, 9), value.players[0]] }, value.matchId)).toBeNull();
  });
});
