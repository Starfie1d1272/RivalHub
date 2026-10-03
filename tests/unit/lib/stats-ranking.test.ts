import { describe, expect, it } from "vitest";
import { partitionRankingPopulation } from "@/lib/stats/ranking";

describe("shared statistics ranking eligibility", () => {
  const value = (row: { rate: number | null }) => row.rate;
  const sample = (row: { sample: number }) => row.sample;
  it("excludes a one-opportunity perfect rate from a qualified population", () => {
    const rows = [{ rate: 1, sample: 1 }, { rate: 0.8, sample: 40 }, { rate: 0.6, sample: 60 }];
    const result = partitionRankingPopulation(rows, value, sample);
    expect(result.dynamicFloor?.floor).toBe(15);
    expect(result.ranked).toEqual(rows.slice(1));
    expect(result.limited).toEqual([rows[0]]);
    expect(rows).toHaveLength(3);
  });
  it("excludes missing values from the baseline and keeps valid zero/negative values", () => {
    const rows = [{ rate: null, sample: 10000 }, { rate: 0, sample: 8 }, { rate: -1, sample: 8 }];
    expect(partitionRankingPopulation(rows, value, sample).ranked).toEqual(rows.slice(1));
  });
  it("uses the full baseline when a consumer filters visible rows", () => {
    const rows = [{ rate: 1, sample: 1 }];
    expect(partitionRankingPopulation(rows, value, sample, [...rows, { rate: 0.8, sample: 100 }]).ranked).toEqual([]);
    expect(partitionRankingPopulation(rows, value, sample).ranked).toEqual(rows);
  });
  it("does not invent a winner for an empty or zero-opportunity population", () => {
    expect(partitionRankingPopulation([], value, sample).ranked).toEqual([]);
    expect(partitionRankingPopulation([{ rate: null, sample: 0 }], value, sample).ranked).toEqual([]);
  });
});
