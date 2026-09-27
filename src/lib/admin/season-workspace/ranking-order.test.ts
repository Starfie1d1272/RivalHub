import { describe, expect, it } from "vitest";
import { initialPreliminaryOrder, moveRankingEntry } from "./ranking-order";

describe("Major ranking draft", () => {
  it("reloads the saved preliminary decision, then moves displayed #2 to #3", () => {
    const order = initialPreliminaryOrder(["A", "C", "B"], [
      { entryId: "A", preliminarySeed: 1 },
      { entryId: "C", preliminarySeed: 3 },
      { entryId: "B", preliminarySeed: 2 },
    ]);
    expect(order).toEqual(["A", "B", "C"]);
    expect(moveRankingEntry(order, "B", 3)).toEqual(["A", "C", "B"]);
  });

  it("keeps a complete permutation for drag, arrows and move-to", () => {
    const source = ["A", "B", "C", "D"];
    expect(moveRankingEntry(source, "D", 1)).toEqual(["D", "A", "B", "C"]);
    expect(moveRankingEntry(source, "B", 1)).toEqual(["B", "A", "C", "D"]);
    expect(moveRankingEntry(source, "B", 3)).toEqual(["A", "C", "B", "D"]);
    expect(moveRankingEntry(source, "A", 4)).toEqual(["B", "C", "D", "A"]);
    expect(moveRankingEntry(source, "A", 0)).toEqual(source);
    expect(moveRankingEntry(source, "D", 5)).toEqual(source);
    expect(source).toEqual(["A", "B", "C", "D"]);
  });
});
