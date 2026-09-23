import { describe, expect, it } from "vitest";
import { getDynamicRankingFloor, isRankingEligible } from "./ranking";

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
