import { describe, expect, it } from "vitest";
import { selectAutoPickCandidate } from "@/lib/draft/auto-pick";

const candidates = [
  {
    registrationId: "awp-high",
    primaryPosition: "awper",
    peakRating: 2.3,
  },
  {
    registrationId: "igl-best-open-position",
    primaryPosition: "igl",
    peakRating: 2.1,
  },
  {
    registrationId: "anchor-low",
    primaryPosition: "anchor",
    peakRating: 1.6,
  },
];

describe("selectAutoPickCandidate", () => {
  it("selects the highest rated eligible player while skipping capped positions", () => {
    const selected = selectAutoPickCandidate(candidates, { awper: 2, igl: 1 });

    expect(selected?.registrationId).toBe("igl-best-open-position");
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
