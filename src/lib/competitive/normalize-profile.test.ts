import { describe, it, expect } from "vitest";
import { normalizeCompetitivePeaks, type HistoricalPeak, type SeasonPeak } from "./normalize-profile";
import { BUILT_IN_COMPETITIVE_PLATFORMS } from "./builtins";

const historical: HistoricalPeak = { status: "ranked", rank: "黄金S", stars: 17, rating: 1.14, achievedSeasonKey: "s18" };
const ladder = BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world.ranks;
const season = (rank: string, stars: number | null, rating = 1.14, seasonKey = "s18"): SeasonPeak => ({ seasonKey, status: "ranked", rank, stars, rating });
describe("competitive peak normalization", () => {
  it.each([{ peaks: [] }, { peaks: [{ seasonKey: "s18", status: "unrecorded" as const }] }])("writes through all peak fields to an absent/unrecorded season", ({ peaks }) => {
    expect(normalizeCompetitivePeaks(historical, peaks, ladder).seasonPeaks).toContainEqual({ status: "ranked", rank: historical.rank, stars: historical.stars, rating: historical.rating, seasonKey: "s18" });
  });
  it.each([season("青铜S", 0), season("黄金S", 18), season("黄金S", 17, 1.15), { seasonKey: "s18", status: "unranked", rating: null } as SeasonPeak])("rejects conflicting rank, stars, Rating and unranked", peak => {
    expect(() => normalizeCompetitivePeaks(historical, [peak], ladder)).toThrow(/历史最高.*s18.*记录为/);
  });
  it("promotes stronger season rank/stars atomically without Rating ordering", () => {
    const peaks = [season("黄金S", 17), season("钻石S", 30, 0.8, "s19")];
    expect(normalizeCompetitivePeaks(historical, peaks, ladder).historicalPeak).toMatchObject({ rank: "钻石S", stars: 30, rating: 0.8, achievedSeasonKey: "s19" });
    expect(normalizeCompetitivePeaks(historical, [season("黄金S", 17), season("黄金S", 18, 0.7, "s19")], ladder).historicalPeak.stars).toBe(18);
  });
  it("keeps equal peak provenance despite higher Rating, and unknown seasons independent", () => {
    expect(normalizeCompetitivePeaks(historical, [season("黄金S", 17), season("黄金S", 17, 10, "s19")], ladder).historicalPeak).toEqual(historical);
    expect(normalizeCompetitivePeaks({ ...historical, achievedSeasonKey: null }, [season("青铜S", 0)], ladder).historicalPeak.achievedSeasonKey).toBeNull();
  });
  it("applies the same rule to 5E", () => {
    const peak = { ...historical, rank: "SS", stars: 25 };
    expect(normalizeCompetitivePeaks(peak, [], BUILT_IN_COMPETITIVE_PLATFORMS.fivee.ranks).seasonPeaks[0]).toMatchObject({ rank: "SS", stars: 25, rating: 1.14 });
  });
});
