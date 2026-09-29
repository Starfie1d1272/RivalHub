import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLiveSnapshotV1 } from "@/lib/mizar/protocol";
import { acceptsLiveDelivery, liveFreshness, mergeLiveDelivery, projectPublicLive } from "@/lib/mizar/live-projection";

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/contracts/mizar-live-snapshot-v1.radar.json", import.meta.url), "utf8"));

describe("Mizar public live contract", () => {
  it("accepts the producer's calibrated multi-floor Radar fixture and projects only public data", () => {
    const snapshot = parseLiveSnapshotV1(fixture);
    const publicLive = projectPublicLive(snapshot, 1, "2026-09-28T00:00:00.100Z");
    expect(publicLive.radar?.layers).toEqual(["upper", "lower"]);
    expect(publicLive.radar?.bomb?.position?.layer).toBe("lower");
    expect(publicLive.radar?.utility).toHaveLength(2);
    expect(JSON.stringify(publicLive)).not.toContain("producerInstanceId");
    expect(JSON.stringify(publicLive)).not.toContain("liveSessionId");
  });

  it("rejects unsupported, oversized and mismatched Radar input", () => {
    expect(() => parseLiveSnapshotV1({ ...fixture, schemaVersion: "mizar.live-snapshot.v2" })).toThrow();
    expect(() => parseLiveSnapshotV1({ ...fixture, oversized: "x".repeat(262_144) })).toThrow("output_payload_too_large");
    expect(() => parseLiveSnapshotV1({ ...fixture, radar: { ...fixture.radar, mapName: "de_mirage" } })).toThrow();
  });

  it("orders delivery by trusted arrival and semantic cursor even with producer clock skew", () => {
    const first = projectPublicLive(parseLiveSnapshotV1(fixture), 1, "2026-09-28T00:00:00.100Z");
    const heartbeat = projectPublicLive(parseLiveSnapshotV1({ ...fixture, producedAt: "2026-09-27T23:59:00.000Z" }), 1, "2026-09-28T00:00:01.100Z");
    expect(acceptsLiveDelivery(first, heartbeat, fixture.matchId)).toBe(true);
    expect(mergeLiveDelivery(first, heartbeat, fixture.matchId)).toMatchObject({ receivedAt: heartbeat.receivedAt, producedAt: first.producedAt });
    expect(acceptsLiveDelivery(heartbeat, first, fixture.matchId)).toBe(false);
    expect(acceptsLiveDelivery(first, first, fixture.matchId)).toBe(false);
    expect(acceptsLiveDelivery(first, heartbeat, "another-match")).toBe(false);
    const olderSequence = projectPublicLive(parseLiveSnapshotV1({ ...fixture, cursor: { ...fixture.cursor, runtimeSeq: fixture.cursor.runtimeSeq - 1 } }), 1, "2026-09-28T00:00:02.100Z");
    expect(acceptsLiveDelivery(heartbeat, olderSequence, fixture.matchId)).toBe(false);
    const newerSequence = projectPublicLive(parseLiveSnapshotV1({ ...fixture, cursor: { ...fixture.cursor, runtimeSeq: fixture.cursor.runtimeSeq + 1 } }), 1, "2026-09-28T00:00:03.100Z");
    expect(acceptsLiveDelivery(heartbeat, newerSequence, fixture.matchId)).toBe(true);
    const newAuthority = projectPublicLive(parseLiveSnapshotV1(fixture), 2, "2026-09-28T00:00:04.100Z");
    expect(acceptsLiveDelivery(newerSequence, newAuthority, fixture.matchId)).toBe(true);
    expect(acceptsLiveDelivery(null, first, fixture.matchId)).toBe(true);
    expect(liveFreshness(3_000)).toBe("fresh");
    expect(liveFreshness(3_001)).toBe("stale");
    expect(liveFreshness(10_001)).toBe("unavailable");
  });
});
