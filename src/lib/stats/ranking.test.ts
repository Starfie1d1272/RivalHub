import { describe, expect, it } from "vitest";
import { getDynamicRankingFloor, isRankingEligible, partitionRankingPopulation } from "./ranking";

describe("dynamic stats ranking floor", () => {
  it("uses the positive-sample P75 and one quarter of that reference", () => {
    expect(getDynamicRankingFloor([5, 20, 80, 100])).toEqual({
      floor: 20,
      reference: 80,
      quantile: 0.75,
      share: 0.25,
    });
  });

  it("adapts to an early-event cohort without imposing a fixed round floor", () => {
    expect(getDynamicRankingFloor([20, 21, 22, 24])?.floor).toBe(6);
  });

  it("ignores zero and missing observations when establishing the positive-sample baseline", () => {
    expect(getDynamicRankingFloor([0, 0, null, undefined, 1, 1, 2])?.floor).toBe(1);
  });

  it("keeps the mathematical lower bound at one observation", () => {
    expect(getDynamicRankingFloor([1])?.floor).toBe(1);
    expect(isRankingEligible(1, 1)).toBe(true);
    expect(isRankingEligible(0, 1)).toBe(false);
  });
});

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
    expect(partitionRankingPopulation<{ rate: number | null; sample: number }>([], value, sample).ranked).toEqual([]);
    expect(partitionRankingPopulation([{ rate: null, sample: 0 }], value, sample).ranked).toEqual([]);
  });
});
