/**
 * The built-in competitive platform definitions are the code-owned product
 * oracle the 0020 bootstrap writes and the migration replay derives its
 * expected database state from. These tests pin their shape without
 * duplicating the ladder.
 */
import { describe, expect, it } from "vitest";
import { BUILT_IN_COMPETITIVE_PLATFORMS, BUILT_IN_COMPETITIVE_PLATFORM_KEYS, isBuiltInCompetitivePlatformKey } from "@/lib/competitive/builtins";

function expectContiguousLadder(ranks: Array<{ sortOrder: number }>): void {
  ranks.forEach((rank, index) => expect(rank.sortOrder).toBe(index));
}

describe("built-in competitive platform definitions", () => {
  it("ships exactly the two confirmed 2.0 platform identities", () => {
    expect(BUILT_IN_COMPETITIVE_PLATFORM_KEYS).toEqual(["perfect_world", "fivee"]);
    expect(isBuiltInCompetitivePlatformKey("perfect_world")).toBe(true);
    expect(isBuiltInCompetitivePlatformKey("fivee")).toBe(true);
    expect(isBuiltInCompetitivePlatformKey("faceit")).toBe(false);
  });

  it("pins Perfect World on Rating Pro with the shared ladder and S-tier star ranges", () => {
    const perfect = BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world;
    expect(perfect.displayName).toBe("完美世界竞技平台");
    expect(perfect.ratingLabel).toBe("Rating Pro");
    expect(perfect.ranks.map((rank) => rank.rankKey)).toEqual([
      "D", "C", "C+", "C++", "B", "B+", "B++", "A", "A+", "A++", "青铜S", "黄金S", "钻石S", "魔王S",
    ]);
    expectContiguousLadder(perfect.ranks);
    expect(perfect.ranks.filter((rank) => rank.rankKey.length <= 3).slice(0, 10).every((rank) => rank.starMin === null && rank.starMax === null)).toBe(true);
    expect(perfect.ranks.filter((rank) => rank.rankKey.endsWith("S"))).toEqual([
      { rankKey: "青铜S", label: "青铜S", sortOrder: 10, starMin: 0, starMax: 9 },
      { rankKey: "黄金S", label: "黄金S", sortOrder: 11, starMin: 10, starMax: 24 },
      { rankKey: "钻石S", label: "钻石S", sortOrder: 12, starMin: 25, starMax: 49 },
      { rankKey: "魔王S", label: "魔王S", sortOrder: 13, starMin: 50, starMax: null },
    ]);
  });

  it("pins 5E on Rating+ and shares the Perfect below-S foundation", () => {
    const fivee = BUILT_IN_COMPETITIVE_PLATFORMS.fivee;
    expect(fivee.displayName).toBe("5E");
    expect(fivee.ratingLabel).toBe("Rating+");
    expect(fivee.ranks.map((rank) => rank.rankKey)).toEqual([
      "D", "C", "C+", "C++", "B", "B+", "B++", "A", "A+", "A++", "S", "SS", "SSS",
    ]);
    expectContiguousLadder(fivee.ranks);
    expect(fivee.ranks.slice(0, 10)).toEqual(BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world.ranks.slice(0, 10));
    expect(fivee.ranks.slice(10)).toEqual([
      { rankKey: "S", label: "S", sortOrder: 10, starMin: 0, starMax: 19 },
      { rankKey: "SS", label: "SS", sortOrder: 11, starMin: 20, starMax: 39 },
      { rankKey: "SSS", label: "SSS", sortOrder: 12, starMin: 40, starMax: null },
    ]);
  });
});
