import { describe, expect, it } from "vitest";
import { formatStat } from "@/lib/stats/format";

describe("formatStat", () => {
  it("applies the canonical precision and units", () => {
    expect(formatStat("ratingPro", 1.2)).toBe("1.20");
    expect(formatStat("adr", 80)).toBe("80.0");
    expect(formatStat("rws", 10.18)).toBe("10.18");
    expect(formatStat("we", 13.5)).toBe("13.5");
    expect(formatStat("hsPercent", 0)).toBe("0%");
    expect(formatStat("kd", 0)).toBe("0.00");
    expect(formatStat("kpr", 0)).toBe("0.00");
    expect(formatStat("fkpr", 0.012)).toBe("1.20");
    expect(formatStat("mkpr", 0.0467)).toBe("4.67");
    expect(formatStat("cpr", 0.0094)).toBe("0.94");
  });

  it("renders unknown values as an em dash and keeps zero visible", () => {
    expect(formatStat("ratingPro", null)).toBe("—");
    expect(formatStat("adr", undefined)).toBe("—");
    expect(formatStat("kills", 0)).toBe("0");
  });
});
