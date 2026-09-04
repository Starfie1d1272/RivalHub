import { describe, expect, it } from "vitest";
import { convertFiveeToPerfect, FIVE_TO_PERFECT_2026_09 } from "./conversion-policy";

describe("convertFiveeToPerfect (2026.09)", () => {
  const mapping = FIVE_TO_PERFECT_2026_09;

  it("maps all below-S ranks directly", () => {
    expect(convertFiveeToPerfect("D", null, mapping)).toEqual({ rank: "D", stars: null });
    expect(convertFiveeToPerfect("C", null, mapping)).toEqual({ rank: "C", stars: null });
    expect(convertFiveeToPerfect("C+", null, mapping)).toEqual({ rank: "C+", stars: null });
    expect(convertFiveeToPerfect("C++", null, mapping)).toEqual({ rank: "C++", stars: null });
    expect(convertFiveeToPerfect("B", null, mapping)).toEqual({ rank: "B", stars: null });
    expect(convertFiveeToPerfect("B+", null, mapping)).toEqual({ rank: "B", stars: null });
    expect(convertFiveeToPerfect("B++", null, mapping)).toEqual({ rank: "B+", stars: null });
    expect(convertFiveeToPerfect("A", null, mapping)).toEqual({ rank: "B++", stars: null });
    expect(convertFiveeToPerfect("A+", null, mapping)).toEqual({ rank: "A", stars: null });
    expect(convertFiveeToPerfect("A++", null, mapping)).toEqual({ rank: "A+", stars: null });
  });

  it("maps S-tier total stars with ceil and exact boundary endpoints", () => {
    // Segment 1: 0..5 -> A++ (stars: null)
    expect(convertFiveeToPerfect("S", 0, mapping)).toEqual({ rank: "A++", stars: null });
    expect(convertFiveeToPerfect("S", 5, mapping)).toEqual({ rank: "A++", stars: null });

    // Segment 2: 6..12 -> 青铜S (targetStarFloor: 0, slope 3/2)
    expect(convertFiveeToPerfect("S", 6, mapping)).toEqual({ rank: "青铜S", stars: 0 });
    expect(convertFiveeToPerfect("S", 12, mapping)).toEqual({ rank: "青铜S", stars: 9 });

    // Segment 3: 13..25 -> 黄金S (targetStarFloor: 10, slope 14/12)
    expect(convertFiveeToPerfect("SS", 13, mapping)).toEqual({ rank: "黄金S", stars: 10 });
    expect(convertFiveeToPerfect("SS", 25, mapping)).toEqual({ rank: "黄金S", stars: 24 });

    // Segment 4: 26..45 -> 钻石S (targetStarFloor: 25, slope 24/19)
    expect(convertFiveeToPerfect("SSS", 26, mapping)).toEqual({ rank: "钻石S", stars: 25 });
    expect(convertFiveeToPerfect("SSS", 45, mapping)).toEqual({ rank: "钻石S", stars: 49 });

    // Segment 5: 46+ -> 魔王S (targetStarFloor: 50, slope 1/1)
    expect(convertFiveeToPerfect("SSS", 46, mapping)).toEqual({ rank: "魔王S", stars: 50 });
    expect(convertFiveeToPerfect("SSS", 100, mapping)).toEqual({ rank: "魔王S", stars: 104 });
  });

  it("fails closed on missing stars for S-tier ranks", () => {
    expect(convertFiveeToPerfect("S", null, mapping)).toBeNull();
    expect(convertFiveeToPerfect("SS", null, mapping)).toBeNull();
    expect(convertFiveeToPerfect("SSS", null, mapping)).toBeNull();
  });

  it("fails closed on negative or non-integer stars", () => {
    expect(convertFiveeToPerfect("S", -1, mapping)).toBeNull();
    expect(convertFiveeToPerfect("S", -10, mapping)).toBeNull();
    expect(convertFiveeToPerfect("S", 5.5, mapping)).toBeNull();
    expect(convertFiveeToPerfect("S", Number.NaN, mapping)).toBeNull();
    expect(convertFiveeToPerfect("S", Number.POSITIVE_INFINITY, mapping)).toBeNull();
  });

  it("fails closed on unmapped ranks and prototype properties", () => {
    expect(convertFiveeToPerfect("UNKNOWN", null, mapping)).toBeNull();
    expect(convertFiveeToPerfect("constructor", null, mapping)).toBeNull();
    expect(convertFiveeToPerfect("toString", null, mapping)).toBeNull();
    expect(convertFiveeToPerfect("__proto__", null, mapping)).toBeNull();
  });
});
