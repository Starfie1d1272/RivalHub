import { describe, it, expect } from "vitest";
import { aggregateUtilityStats } from "./utility-stats";

describe("aggregateUtilityStats", () => {
  it("空 kills 和空 playerStats 返回空数组", () => {
    const result = aggregateUtilityStats([], []);
    expect(result).toEqual([]);
  });

  it("汇总单个选手的 utility damage", () => {
    const stats = [
      { steamId64: "1", utilityDamage: 500, averageUtilityDamagePerRound: 25 } as any,
    ];
    const result = aggregateUtilityStats([], stats);
    expect(result).toHaveLength(1);
    expect(result[0].steamId64).toBe("1");
    expect(result[0].utilityDamage).toBe(500);
    expect(result[0].avgUtilityDamagePerRound).toBe(25);
  });

  it("统计 kills 中的 flashAssist 和 throughSmoke", () => {
    const kills = [
      { killerSteamId64: "1", flashAssist: true, throughSmoke: false },
      { killerSteamId64: "1", flashAssist: false, throughSmoke: true },
      { killerSteamId64: "1", flashAssist: true, throughSmoke: true },
    ] as any;
    const result = aggregateUtilityStats(kills, []);
    expect(result).toHaveLength(1);
    expect(result[0].flashAssistCount).toBe(2);
    expect(result[0].throughSmokeCount).toBe(2);
  });

  it("合并来自 kills 和 playerStats 的数据", () => {
    const kills = [
      { killerSteamId64: "1", flashAssist: true, throughSmoke: false },
    ] as any;
    const stats = [
      { steamId64: "1", utilityDamage: 300, averageUtilityDamagePerRound: 15 } as any,
    ];
    const result = aggregateUtilityStats(kills, stats);
    expect(result[0].flashAssistCount).toBe(1);
    expect(result[0].utilityDamage).toBe(300);
  });

  it("按 utilityDamage 降序排列", () => {
    const stats = [
      { steamId64: "1", utilityDamage: 100, averageUtilityDamagePerRound: 10 } as any,
      { steamId64: "2", utilityDamage: 500, averageUtilityDamagePerRound: 20 } as any,
      { steamId64: "3", utilityDamage: 200, averageUtilityDamagePerRound: 15 } as any,
    ] as any;
    const result = aggregateUtilityStats([], stats);
    expect(result[0].steamId64).toBe("2");
    expect(result[1].steamId64).toBe("3");
    expect(result[2].steamId64).toBe("1");
  });
});
