import { describe, it, expect } from "vitest";
import { wAvg, sAvg } from "@/lib/utils/stats";

type Item = { maps: number;[key: string]: unknown };

const noMaps: Item[] = [];

const singleSeason: Item[] = [
  { maps: 5, avgRating: 1.25, totalKills: 50 },
];

const multiSeason: Item[] = [
  { maps: 3, avgRating: 1.1, totalKills: 33 },
  { maps: 7, avgRating: 1.3, totalKills: 56 },
];

describe("wAvg", () => {
  it("returns '—' when no maps played", () => {
    expect(wAvg(noMaps, "avgRating")).toBe("—");
  });

  it("returns the field value directly for single season", () => {
    expect(wAvg(singleSeason, "avgRating")).toBe("1.3");
  });

  it("computes weighted average across seasons", () => {
    // (1.1*3 + 1.3*7) / 10 = (3.3 + 9.1) / 10 = 1.24 → "1.2"
    expect(wAvg(multiSeason, "avgRating")).toBe("1.2");
  });

  it("respects precision parameter", () => {
    expect(wAvg(multiSeason, "avgRating", 2)).toBe("1.24");
  });
});

describe("sAvg", () => {
  it("returns '—' when no maps played", () => {
    expect(sAvg(noMaps, "totalKills")).toBe("—");
  });

  it("returns simple average for single season", () => {
    expect(sAvg(singleSeason, "totalKills")).toBe("10.0");
  });

  it("computes simple average across seasons", () => {
    // (33 + 56) / 10 = 89 / 10 = 8.9 → "8.9"
    expect(sAvg(multiSeason, "totalKills")).toBe("8.9");
  });

  it("respects precision parameter", () => {
    expect(sAvg(multiSeason, "totalKills", 2)).toBe("8.90");
  });
});
