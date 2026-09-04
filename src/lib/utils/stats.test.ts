import { describe, it, expect } from "vitest";
import { avgNums, sumNums, weightedAvgNums } from "@/lib/utils/stats";

describe("nullable numeric helpers", () => {
  it("keeps an all-missing count distinct from a real zero", () => {
    expect(sumNums([null, null])).toBeNull();
    expect(sumNums([0, null])).toBe(0);
  });

  it("skips missing values in simple and weighted means", () => {
    expect(avgNums([null, 2, 4])).toBe(3);
    expect(weightedAvgNums([null, 80, 60], [20, 20, 10])).toBeCloseTo(2200 / 30, 10);
    expect(weightedAvgNums([0, null], [0, 20])).toBeNull();
  });
});
