import { describe, expect, it } from "vitest";
import { convertFiveeToPerfect, FIVE_TO_PERFECT_2026_09 } from "./conversion-policy";

describe("convertFiveeToPerfect (2026.09)", () => {
  const mapping = FIVE_TO_PERFECT_2026_09;

  it("maps below-S ranks directly", () => {
    expect(convertFiveeToPerfect("D", null, mapping)).toEqual({ rank: "D", stars: null });
    expect(convertFiveeToPerfect("A", null, mapping)).toEqual({ rank: "B++", stars: null });
    expect(convertFiveeToPerfect("A++", null, mapping)).toEqual({ rank: "A+", stars: null });
  });

  it("maps S-tier total stars with ceil and endpoint alignment", () => {
    expect(convertFiveeToPerfect("S", 0, mapping)).toEqual({ rank: "A++", stars: null });
    expect(convertFiveeToPerfect("S", 6, mapping)).toEqual({ rank: "青铜S", stars: 0 });
    expect(convertFiveeToPerfect("S", 12, mapping)).toEqual({ rank: "青铜S", stars: 9 });
    expect(convertFiveeToPerfect("SS", 13, mapping)).toEqual({ rank: "黄金S", stars: 10 });
    expect(convertFiveeToPerfect("SS", 25, mapping)).toEqual({ rank: "黄金S", stars: 24 });
    expect(convertFiveeToPerfect("SSS", 26, mapping)).toEqual({ rank: "钻石S", stars: 25 });
    expect(convertFiveeToPerfect("SSS", 45, mapping)).toEqual({ rank: "钻石S", stars: 49 });
    expect(convertFiveeToPerfect("SSS", 46, mapping)).toEqual({ rank: "魔王S", stars: 50 });
  });

  it("returns null for an S rank without exact stars", () => {
    expect(convertFiveeToPerfect("S", null, mapping)).toBeNull();
  });
});
