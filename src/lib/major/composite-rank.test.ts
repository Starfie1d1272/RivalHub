import { expect, it, describe } from "vitest";
import { compositeStrength, compositeDisplayRank } from "./composite-rank";
import { PERFECT_WORLD_RANK_ORDER } from "@/lib/config/perfect-world";
import { getPlayerStrengthBreakdown } from "./player-strength";
const config = { platform: "perfect_world", rankOrder: [...PERFECT_WORLD_RANK_ORDER], currentSeasonKey: "s2", previousSeasonKey: "s1" };
describe("composite strength axis", () => {
  it("maps ordinary ranks to 0..9 and S to a continuous exact star axis", () => {
    PERFECT_WORLD_RANK_ORDER.slice(0, 10).forEach((rank, index) => expect(compositeStrength({ rank })).toBe(index));
    for (const stars of [0, 9, 10, 24, 25, 49, 50, 100]) {
      const rank = compositeDisplayRank(12 + stars / 3)!;
      expect(compositeStrength(rank)).toBe(12 + stars / 3);
      expect(rank.stars).toBe(stars);
    }
    expect(compositeStrength({ rank: "黄金S" })).toBeNull();
  });
  it("freezes nearest-point ties toward the stronger rank and preserves the gap", () => {
    expect(compositeDisplayRank(10.49)?.rank).toBe("A++");
    expect(compositeDisplayRank(10.5)).toEqual({ rank: "青铜S", stars: 0 });
    expect(compositeDisplayRank(12 + 0.5 / 3)?.stars).toBe(1);
    expect(compositeDisplayRank(7.5)?.rank).toBe("A+");
    expect(compositeDisplayRank(null)).toBeNull();
  });
  it.each([
    ["Tomato", 68, 30, 25, 48], ["三河", 35, 20, 13, 26], ["Asking", 20, 10, 5, 14], ["Starfie1d", 15, 5, 5, 10],
  ])("calculates representative %s evidence with H/R/P 50/30/20", (_, h, r, p, expected) => {
    const peak = (stars: number) => ({ ...compositeDisplayRank(12 + stars / 3)!, rating: 1 });
    const breakdown = getPlayerStrengthBreakdown({ userId: "fixture", label: "fixture", historicalPeak: peak(h), currentSeasonPeak: peak(r), previousSeasonPeak: peak(p) }, config);
    expect(breakdown.weightedRank).toBeCloseTo(0.5 * (12 + h / 3) + 0.3 * (12 + r / 3) + 0.2 * (12 + p / 3));
    expect(compositeDisplayRank(breakdown.weightedRank)?.stars).toBe(expected);
  });
});
