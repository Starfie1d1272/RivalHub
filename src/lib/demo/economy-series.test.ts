import { describe, it, expect } from "vitest";
import { buildEconomySeries, type EconomyRow, type RoundEconomyType } from "./economy-series";

describe("buildEconomySeries", () => {
  it("按回合汇总两队装备价值", () => {
    const rows: EconomyRow[] = [
      { roundNumber: 1, teamKey: "teamA", equipmentValue: 4000, type: null },
      { roundNumber: 1, teamKey: "teamB", equipmentValue: 800, type: null },
      { roundNumber: 2, teamKey: "teamA", equipmentValue: 4500, type: null },
    ];
    const series = buildEconomySeries(rows);
    expect(series[0]).toMatchObject({ roundNumber: 1, teamA: 4000, teamB: 800 });
    expect(series[1].teamA).toBe(4500);
  });

  it("缺侧补 0", () => {
    const rows: EconomyRow[] = [
      { roundNumber: 1, teamKey: "teamA", equipmentValue: 3000, type: null },
    ];
    const series = buildEconomySeries(rows);
    expect(series[0]).toMatchObject({ roundNumber: 1, teamA: 3000, teamB: 0 });
  });

  it("多玩家同队同回合求和", () => {
    const rows: EconomyRow[] = [
      { roundNumber: 1, teamKey: "teamA", equipmentValue: 2500, type: null },
      { roundNumber: 1, teamKey: "teamA", equipmentValue: 3000, type: null },
      { roundNumber: 1, teamKey: "teamB", equipmentValue: 1000, type: null },
    ];
    const series = buildEconomySeries(rows);
    expect(series[0]).toMatchObject({ roundNumber: 1, teamA: 5500, teamB: 1000 });
  });

  it("空数组返回空数组", () => {
    expect(buildEconomySeries([])).toEqual([]);
  });

  it("接受 round-level 经济类型", () => {
    const rows: EconomyRow[] = [
      { roundNumber: 1, teamKey: "teamA", equipmentValue: 4000, type: null },
    ];
    const roundTypes: RoundEconomyType[] = [
      { roundNumber: 1, teamAEconomy: "full", teamBEconomy: "eco" },
    ];
    const series = buildEconomySeries(rows, roundTypes);
    expect(series[0].teamAEconomy).toBe("full");
    expect(series[0].teamBEconomy).toBe("eco");
  });
});
