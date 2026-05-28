import { describe, it, expect } from "vitest";
import { sortByMetric, computeRecommendedMvp } from "./mvp";

type Row = { perfectName: string; adr: number | null; kills: number | null; deaths: number | null; ratingPro: number | null };

const rows: Row[] = [
  { perfectName: "A", adr: 90, kills: 20, deaths: 15, ratingPro: 1.3 },
  { perfectName: "B", adr: 70, kills: 18, deaths: 18, ratingPro: 1.1 },
  { perfectName: "C", adr: 110, kills: 25, deaths: 14, ratingPro: 1.5 },
];

describe("sortByMetric", () => {
  it("按指定指标降序,null 视为最小", () => {
    const sorted = sortByMetric(rows, "ratingPro");
    expect(sorted.map((r) => r.perfectName)).toEqual(["C", "A", "B"]);
  });
  it("可切换到 adr 口径", () => {
    expect(sortByMetric(rows, "adr").map((r) => r.perfectName)).toEqual(["C", "A", "B"]);
  });
});

describe("computeRecommendedMvp", () => {
  it("用 ADR 排名 + K/D 排名复合分,返回名次最佳者", () => {
    const mvp = computeRecommendedMvp(rows);
    expect(mvp?.perfectName).toBe("C");
  });
  it("空数组返回 null", () => {
    expect(computeRecommendedMvp([])).toBeNull();
  });
});
