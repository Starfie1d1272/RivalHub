import { describe, expect, it } from "vitest";
import { broadcastMatchSupport } from "./stats-support";

describe("broadcast match support", () => {
  it("preserves big integer totals and calculates ratios without precision loss", () => {
    expect(broadcastMatchSupport([{ entryId: "a", amount: "60047995031606620" }, { entryId: "b", amount: "30023997515803310" }], ["a", "b"])).toEqual({ total: "90071992547409930", sides: [{ entryId: "a", amount: "60047995031606620", ratio: 0.666666666 }, { entryId: "b", amount: "30023997515803310", ratio: 0.333333333 }] });
  });
  it("keeps zero support unavailable and rejects a different frozen matchup", () => {
    expect(broadcastMatchSupport([{ entryId: "a", amount: "0" }, { entryId: "b", amount: "0" }], ["a", "b"])?.sides.map(side => side.ratio)).toEqual([null, null]);
    expect(broadcastMatchSupport([{ entryId: "a", amount: "2" }, { entryId: "old", amount: "3" }], ["a", "b"])).toBeNull();
    expect(broadcastMatchSupport(null, ["a", "b"])).toBeNull();
  });
});
