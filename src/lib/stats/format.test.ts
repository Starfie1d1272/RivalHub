import { describe, expect, it } from "vitest";
import { formatStatsMetric, formatStatsRate } from "./presentation";
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


describe("analytics metric formatting", () => {
  it("scales per-round frequencies using raw counts rather than rounded rates", () => {
    expect(formatStatsRate("flashAssist", { rate: 0.05, successes: 15, attempts: 301 })).toBe("4.98");
    expect(formatStatsRate("firstKill", { rate: 0.17, successes: 5, attempts: 30 })).toBe("16.67");
  });
  it("keeps native scales and metric-specific precision", () => {
    expect(formatStatsMetric("kpr", 0.98)).toBe("0.98");
    expect(formatStatsMetric("mk", 0.1651)).toBe("16.5");
    expect(formatStatsRate("trade", { rate: 0.146, successes: 29, attempts: 199 })).toBe("14.6");
  });
});
