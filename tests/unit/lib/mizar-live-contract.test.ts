import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_SNAPSHOT_MAX_BYTES, parseLiveSnapshotV1, parseReliableEventV1, RELIABLE_EVENT_SCHEMA_VERSION } from "@/lib/mizar/protocol";
import { PUBLIC_LIVE_MAX_BYTES, projectPublicLive } from "@/lib/mizar/live-projection";

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/contracts/mizar-live-snapshot-v1.radar.json", import.meta.url), "utf8"));

describe("Mizar live snapshot wire contract", () => {
  it("accepts the producer calibrated multi-floor Radar fixture and projects only public data", () => {
    const snapshot = parseLiveSnapshotV1(fixture);
    const publicLive = projectPublicLive(snapshot, 1, "2026-09-28T00:00:00.100Z");
    expect(publicLive.radar?.layers).toEqual(["upper", "lower"]);
    expect(publicLive.radar?.bomb?.position?.layer).toBe("lower");
    expect(publicLive.radar?.utility).toHaveLength(2);
    expect(publicLive.delivery).toEqual({ authorityRevision: 1, generation: 0, epoch: 1, sequence: 1 });
    const serialized = JSON.stringify(publicLive);
    expect(serialized).not.toContain("producerInstanceId");
    expect(serialized).not.toContain("liveSessionId");
    expect(serialized).not.toContain("programReceiveSequence");
  });

  it("keeps the public payload hard bound below the producer bound", () => {
    expect(PUBLIC_LIVE_MAX_BYTES).toBe(192 * 1024);
    expect(PUBLIC_LIVE_MAX_BYTES).toBeLessThan(LIVE_SNAPSHOT_MAX_BYTES);
  });

  it("rejects unsupported versions, oversized bodies and current-Radar violations", () => {
    expect(() => parseLiveSnapshotV1({ ...fixture, schemaVersion: "mizar.live-snapshot.v2" })).toThrow();
    expect(() => parseLiveSnapshotV1({ ...fixture, oversized: "x".repeat(LIVE_SNAPSHOT_MAX_BYTES) })).toThrow("output_payload_too_large");
    expect(() => parseLiveSnapshotV1({ ...fixture, radar: { ...fixture.radar, mapName: "de_mirage" } })).toThrow();
    expect(() => parseLiveSnapshotV1({ ...fixture, capability: { ...fixture.capability, radarCurrent: false } })).toThrow();
    expect(() => parseLiveSnapshotV1({ ...fixture, series: { ...fixture.series, currentMapOrder: 2 } })).toThrow();
    expect(() => parseLiveSnapshotV1({ ...fixture, roundHistory: { ...fixture.roundHistory, mapOrder: 7 } })).toThrow();
    expect(() => parseLiveSnapshotV1({ ...fixture, radar: { ...fixture.radar, activeLayer: "lower" } })).not.toThrow();
    expect(() => parseLiveSnapshotV1({ ...fixture, radar: { ...fixture.radar, layers: ["upper"] } })).toThrow();
    // A single-layer calibration must use the reserved 'single' layer for every point.
    const singleLayer = { ...fixture, radar: { ...fixture.radar, layers: ["single"], activeLayer: "single", players: fixture.radar.players.map((player: { position: { layer: string } | null }) => ({ ...player, position: player.position ? { ...player.position, layer: "single" } : null })), bomb: { position: { x: 0.25, y: 0.75, layer: "single" } }, utility: [] } };
    expect(parseLiveSnapshotV1(singleLayer).radar?.layers).toEqual(["single"]);
    expect(() => parseLiveSnapshotV1({ ...singleLayer, radar: { ...singleLayer.radar, layers: ["single", "upper"] } })).toThrow();
    expect(() => parseLiveSnapshotV1({ ...fixture, radar: null, capability: { ...fixture.capability, radarCurrent: false } })).not.toThrow();
  });

  it("keeps Round History completeness, C4 and utility parsing on the frozen protocol", () => {
    for (const completeness of ["complete", "partial", "unavailable"] as const) {
      expect(parseLiveSnapshotV1({ ...fixture, roundHistory: { ...fixture.roundHistory, completeness } }).roundHistory?.completeness).toBe(completeness);
    }
    expect(parseLiveSnapshotV1({ ...fixture, roundHistory: { ...fixture.roundHistory, rounds: [] } }).roundHistory?.rounds).toEqual([]);
    const parsed = parseLiveSnapshotV1(fixture);
    expect(parsed.radar?.utility.find((entry) => entry.kind === "smoke")?.effectTimeSeconds).toBe(5);
    expect(parsed.radar?.utility.find((entry) => entry.kind === "inferno")?.flames).toHaveLength(1);
    expect(parseLiveSnapshotV1({ ...fixture, bomb: { state: "planted", carrierSourceId: null, action: { kind: "plant", sourcePlayerId: null, remainingSeconds: 3, durationSeconds: 3 } } }).bomb?.state).toBe("planted");
  });
});

describe("Mizar reliable event wire contract", () => {
  const base = {
    schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION,
    idempotencyKey: "evt-1",
    cursor: { producerInstanceId: "producer-1", liveSessionId: "live-1", runtimeSeq: 4, programSourceGeneration: 0, programReceiveSequence: 4, mapEpoch: 1 },
    observedAt: "2026-09-28T00:00:00.000Z",
    matchId: "match-1",
    competitionId: "competition-1",
    contextRevision: "rev-1",
    mapId: "map-1",
    mapName: "de_ancient",
    entryAId: "entry-a",
    entryBId: "entry-b",
    evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" },
  };

  it("accepts exactly the eight owned reliable kinds", () => {
    const kinds: Array<[string, unknown]> = [
      ["match_started", {}],
      ["map_started", {}],
      ["map_ended", { scoreA: 13, scoreB: 9, scoreCT: 9, scoreT: 4 }],
      ["series_ended", { scoreA: 2, scoreB: 1 }],
      ["source_generation_changed", { previousSourceGeneration: 0 }],
      ["map_epoch_changed", { previousMapEpoch: 1, reason: "producer-restart" }],
      ["identity_mismatch", { reason: null }],
      ["lineup_mismatch", { reason: null }],
    ];
    for (const [kind, payload] of kinds) {
      expect(parseReliableEventV1({ ...base, kind, payload }).kind).toBe(kind);
    }
    expect(() => parseReliableEventV1({ ...base, kind: "map_paused", payload: {} })).toThrow();
  });

  it("keeps scoreA/scoreB entrant-relative and CT/T evidence-only", () => {
    const ended = parseReliableEventV1({ ...base, kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } });
    expect(ended.kind).toBe("map_ended");
    if (ended.kind !== "map_ended") throw new Error("unreachable");
    expect([ended.payload.scoreA, ended.payload.scoreB, ended.payload.scoreCT, ended.payload.scoreT]).toEqual([13, 9, 4, 9]);
    expect(() => parseReliableEventV1({ ...base, kind: "map_ended", payload: { scoreA: -1, scoreB: 0, scoreCT: 0, scoreT: 0 } })).toThrow();
  });

  it("rejects unsupported versions, unknown fields and mismatched payloads", () => {
    expect(() => parseReliableEventV1({ ...base, schemaVersion: "mizar.reliable-event.v2", kind: "map_started", payload: {} })).toThrow();
    expect(() => parseReliableEventV1({ ...base, kind: "map_started", payload: {}, extra: true })).toThrow();
    expect(() => parseReliableEventV1({ ...base, kind: "map_started", payload: { scoreA: 1 } })).toThrow();
  });
});
