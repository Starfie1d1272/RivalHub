import { describe, it, expect } from "vitest";
import { buildEconomySeries, type EconomyRow } from "./economy-series";

describe("buildEconomySeries", () => {
  it("按回合汇总两队装备价值", () => {
    const rows: EconomyRow[] = [
      { roundNumber: 1, teamKey: "teamA", equipmentValue: 4000 },
      { roundNumber: 1, teamKey: "teamB", equipmentValue: 800 },
      { roundNumber: 2, teamKey: "teamA", equipmentValue: 4500 },
    ];
    const series = buildEconomySeries(rows);
    expect(series[0]).toEqual({ roundNumber: 1, teamA: 4000, teamB: 800 });
    expect(series[1].teamA).toBe(4500);
  });

  it("缺侧补 0", () => {
    const rows: EconomyRow[] = [
      { roundNumber: 1, teamKey: "teamA", equipmentValue: 3000 },
    ];
    const series = buildEconomySeries(rows);
    expect(series[0]).toEqual({ roundNumber: 1, teamA: 3000, teamB: 0 });
  });

  it("多玩家同队同回合求和", () => {
    const rows: EconomyRow[] = [
      { roundNumber: 1, teamKey: "teamA", equipmentValue: 2500 },
      { roundNumber: 1, teamKey: "teamA", equipmentValue: 3000 },
      { roundNumber: 1, teamKey: "teamB", equipmentValue: 1000 },
    ];
    const series = buildEconomySeries(rows);
    expect(series[0]).toEqual({ roundNumber: 1, teamA: 5500, teamB: 1000 });
  });

  it("空数组返回空数组", () => {
    expect(buildEconomySeries([])).toEqual([]);
  });
});
