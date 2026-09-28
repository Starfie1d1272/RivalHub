import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLiveSnapshotV1 } from "@/lib/mizar/protocol";
import { acceptsLiveDelivery, liveFreshness, projectPublicLive } from "@/lib/mizar/live-projection";

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

  it("accepts only the current match and newest heartbeat, with canonical fallback after 10 seconds", () => {
    const first = projectPublicLive(parseLiveSnapshotV1(fixture), 1, "2026-09-28T00:00:00.100Z");
    const heartbeat = projectPublicLive(parseLiveSnapshotV1({ ...fixture, producedAt: "2026-09-28T00:00:01.000Z" }), 1, "2026-09-28T00:00:01.100Z");
    expect(acceptsLiveDelivery(first, heartbeat, fixture.matchId)).toBe(true);
    expect(acceptsLiveDelivery(heartbeat, first, fixture.matchId)).toBe(false);
    expect(acceptsLiveDelivery(first, heartbeat, "another-match")).toBe(false);
    expect(liveFreshness(3_000)).toBe("fresh");
    expect(liveFreshness(3_001)).toBe("stale");
    expect(liveFreshness(10_001)).toBe("unavailable");
  });
});
