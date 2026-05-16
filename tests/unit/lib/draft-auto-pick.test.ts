import { describe, expect, it } from "vitest";
import { selectAutoPickCandidate } from "@/lib/draft/auto-pick";

const candidates = [
  {
    registrationId: "awp-high",
    primaryPosition: "awper",
    peakRating: 2.3,
    peakRank: "S",
    currentRank: "S",
    currentRating: 2.4,
    createdAt: new Date("2025-01-01T00:00:00Z"),
  },
  {
    registrationId: "igl-best-open-position",
    primaryPosition: "igl",
    peakRating: 2.1,
    peakRank: "S",
    currentRank: "A+",
    currentRating: 2.15,
    createdAt: new Date("2025-01-02T00:00:00Z"),
  },
  {
    registrationId: "anchor-low",
    primaryPosition: "anchor",
    peakRating: 1.6,
    peakRank: "A",
    currentRank: "A",
    currentRating: 1.65,
    createdAt: new Date("2025-01-03T00:00:00Z"),
  },
];

describe("selectAutoPickCandidate", () => {
  it("selects the highest ranked player at an empty position first, then falls back to any eligible position", () => {
    const selected = selectAutoPickCandidate(candidates, { awper: 2, igl: 1 });

    // anchor has 0 members (not in positionCounts), so it's picked in round 1
    expect(selected?.registrationId).toBe("anchor-low");
  });

  it("returns null when every remaining player is position capped", () => {
    const selected = selectAutoPickCandidate(candidates, {
      awper: 2,
      igl: 2,
      anchor: 2,
    });

    expect(selected).toBeNull();
  });
});
