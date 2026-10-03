import { describe, expect, it } from "vitest";
import { fromPublicRadar } from "@mizar-hud/radar-view";
import fixture from "../../../tests/fixtures/contracts/mizar-live-snapshot-v1.radar.json";
import { parseLiveSnapshotV1 } from "./protocol";
import { projectPublicLive } from "./live-projection";
import { initialLiveViewerState, receivePublicLive, liveFreshness, liveClockSeconds, resetLiveViewer } from "./live-viewer-state";

function payload(seconds = 0) {
  const wire = parseLiveSnapshotV1(structuredClone(fixture));
  wire.producedAt = new Date(Date.parse(wire.producedAt) + seconds * 1000).toISOString();
  wire.capability.lineupComplete = true; // The ingest gate requires a validated complete lineup.
  wire.clock = { phase: "live", remainingSeconds: 90 };
  return projectPublicLive(wire, 1, wire.producedAt);
}
describe("public LIVE receive boundary", () => {
  it("uses actual public projection and shared adapter including utility and floors", () => {
    const input = payload();
    const state = receivePublicLive(initialLiveViewerState(), input, input.matchId, 100);
    expect(state.snapshot).toEqual(input);
    const frame = fromPublicRadar(state.snapshot!.radar, { boundary: "test", sequence: 1, current: true, bomb: input.bomb });
    expect(frame).not.toBeNull();
    expect(frame?.payload.players).toHaveLength(input.radar!.players.length);
    expect(frame?.payload.grenades).toHaveLength(input.radar!.utility.length);
  });
  it("applies exact monotonic fresh/stale/unavailable thresholds and freezes clock", () => {
    const input = payload();
    const state = receivePublicLive(initialLiveViewerState(), input, input.matchId, 100);
    expect(liveFreshness(state, 3100)).toBe("fresh");
    expect(liveFreshness(state, 3101)).toBe("stale");
    expect(liveFreshness(state, 10100)).toBe("stale");
    expect(liveFreshness(state, 10101)).toBe("unavailable");
    expect(liveClockSeconds(state, 3101)).toBe(87);
    expect(liveClockSeconds(state, 10000)).toBe(87);
    expect(liveClockSeconds(state, 10101)).toBeNull();
    expect(liveFreshness(initialLiveViewerState(), 0)).toBe("unavailable");
  });
  it("accepts a new heartbeat with the same gameplay sequence, rejects duplicate delivery", () => {
    const input = payload();
    const state = receivePublicLive(initialLiveViewerState(), input, input.matchId, 0);
    expect(receivePublicLive(state, input, input.matchId, 3000)).toBe(state);
    const next = receivePublicLive(state, payload(1), input.matchId, 1000);
    expect(next.receivedAt).toBe(1000);
    expect(next.acceptedFrames).toBe(2);
    expect(receivePublicLive(next, input, input.matchId, 2000)).toBe(next);
  });
  it("rejects wrong match, malformed, oversized and stale capability", () => {
    const state = initialLiveViewerState();
    const input = payload();
    for (const value of [{ ...input, matchId: "other" }, { ...input, schemaVersion: "wrong" }, { ...input, players: "x".repeat(200000) }, { ...input, capability: { ...input.capability, telemetryFresh: false } }, null]) {
      expect(receivePublicLive(state, value, input.matchId, 0)).toBe(state);
    }
  });
  it("fences every outer cursor and clears visual history on execution change", () => {
    const first = payload();
    first.delivery = { authorityRevision: 3, generation: 5, epoch: 7, sequence: 10 };
    const state = receivePublicLive(initialLiveViewerState(), first, first.matchId, 0);
    for (const key of ["authorityRevision", "generation", "epoch", "sequence"] as const) {
      const old = payload(1); old.delivery = { ...first.delivery, [key]: first.delivery[key] - 1 };
      expect(receivePublicLive(state, old, first.matchId, 1000)).toBe(state);
    }
    const takeover = payload(1); takeover.delivery.authorityRevision = 4;
    const next = receivePublicLive(state, takeover, first.matchId, 1000);
    expect(next.revision).toBe(1);
    expect(next.snapshot).toEqual(takeover);
  });
  it("accepts a newer authority without assuming globally monotonic wall clocks", () => {
    const first = payload(2);
    const state = receivePublicLive(initialLiveViewerState(), first, first.matchId, 0);
    const takeover = payload(1);
    takeover.delivery.authorityRevision = 2;
    expect(receivePublicLive(state, takeover, first.matchId, 1000).snapshot).toEqual(takeover);
  });
  it("reconnect waits for a new heartbeat while retaining the replay watermark", () => {
    const input = payload();
    const state = receivePublicLive(initialLiveViewerState(), input, input.matchId, 0);
    const reset = resetLiveViewer(state);
    expect(reset.snapshot).toBeNull();
    expect(receivePublicLive(reset, input, input.matchId, 2000)).toBe(reset);
    expect(receivePublicLive(reset, payload(3), input.matchId, 3000).snapshot).not.toBeNull();
  });
});
