import { describe, it, expect } from "vitest";
import { aggregateWeaponStats } from "./weapon-stats";

describe("aggregateWeaponStats", () => {
  it("空输入返回空数组", () => {
    const result = aggregateWeaponStats([]);
    expect(result).toEqual([]);
  });

  it("单次击杀统计正确", () => {
    const result = aggregateWeaponStats([
      { weapon: "AK-47", headshot: true, roundNumber: 1, steamId64: "a" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      weapon: "AK-47",
      kills: 1,
      headshots: 1,
      headshotRate: 1,
      rounds: 1,
    });
  });

  it("同武器多次击杀累加", () => {
    const result = aggregateWeaponStats([
      { weapon: "AK-47", headshot: false, roundNumber: 1, steamId64: "a" },
      { weapon: "AK-47", headshot: true, roundNumber: 2, steamId64: "a" },
      { weapon: "AK-47", headshot: false, roundNumber: 3, steamId64: "a" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      weapon: "AK-47",
      kills: 3,
      headshots: 1,
      headshotRate: 1 / 3,
      rounds: 3,
    });
  });

  it("多武器按武器分组", () => {
    const result = aggregateWeaponStats([
      { weapon: "AK-47", headshot: true, roundNumber: 1, steamId64: "a" },
      { weapon: "M4A4", headshot: false, roundNumber: 1, steamId64: "a" },
      { weapon: "AK-47", headshot: false, roundNumber: 2, steamId64: "a" },
    ]);
    expect(result).toHaveLength(2);
    const ak = result.find((r) => r.weapon === "AK-47")!;
    const m4 = result.find((r) => r.weapon === "M4A4")!;
    expect(ak.kills).toBe(2);
    expect(ak.headshotRate).toBe(0.5);
    expect(m4.kills).toBe(1);
    expect(m4.headshotRate).toBe(0);
  });

  it("不同选手互不干扰（只传单个选手数据）", () => {
    // 纯函数只关心传入行，不查库
    const result = aggregateWeaponStats([
      { weapon: "AK-47", headshot: true, roundNumber: 1, steamId64: "a" },
    ]);
    expect(result[0].kills).toBe(1);
  });

  it("按 kills 降序排列", () => {
    const result = aggregateWeaponStats([
      { weapon: "Deagle", headshot: false, roundNumber: 1, steamId64: "a" },
      { weapon: "AK-47", headshot: true, roundNumber: 1, steamId64: "a" },
      { weapon: "AK-47", headshot: true, roundNumber: 2, steamId64: "a" },
      { weapon: "M4A4", headshot: false, roundNumber: 1, steamId64: "a" },
    ]);
    expect(result[0].weapon).toBe("AK-47"); // 2 kills
    expect(result[1].weapon).toBe("Deagle"); // 1 kill
    expect(result[2].weapon).toBe("M4A4");  // 1 kill
  });
});
