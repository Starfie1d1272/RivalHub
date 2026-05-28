import { describe, it, expect } from "vitest";
import { aggregatePlayerDemoStats } from "./player-demo-stats";
import type { PlayerStatRow, BlindsRow } from "./player-demo-stats";

describe("aggregatePlayerDemoStats", () => {
  it("空 stats 返回 0 值", () => {
    const r = aggregatePlayerDemoStats([]);
    expect(r.totalRounds).toBe(0);
    expect(r.kast).toBe(0);
    expect(r.adr).toBe(0);
    expect(r.clutchAttempts).toBe(0);
    expect(r.blindsEnemies).toBe(0);
  });

  it("基本聚合：KAST/ADR 按回合加权平均", () => {
    const stats: PlayerStatRow[] = [
      {
        kills: 10, deaths: 5, assists: 3,
        adr: 100, kast: 80,
        firstKillCount: 2, firstDeathCount: 1,
        tradeKillCount: 1, tradeDeathCount: 0,
        oneKillCount: 0, twoKillCount: 0, threeKillCount: 0,
        fourKillCount: 0, fiveKillCount: 0,
        vsOneCount: 1, vsOneWonCount: 1,
        vsTwoCount: 0, vsTwoWonCount: 0,
        vsThreeCount: 0, vsThreeWonCount: 0,
        vsFourCount: 0, vsFourWonCount: 0,
        vsFiveCount: 0, vsFiveWonCount: 0,
        utilityDamage: 300,
        averageUtilityDamagePerRound: 16.7,
        wallbangKillCount: 0, noScopeKillCount: 0, collateralKillCount: 0,
      },
    ];
    const r = aggregatePlayerDemoStats(stats);
    expect(r.totalRounds).toBe(18); // 10+5+3
    expect(r.kast).toBeCloseTo(80, 5);
    expect(r.adr).toBeCloseTo(100, 5);
    expect(r.firstKillCount).toBe(2);
    expect(r.firstKillRate).toBeCloseTo(2 / 18, 5);
    expect(r.entrySuccessRate).toBeCloseTo(2 / 3, 5);
    expect(r.utilityDamagePerRound).toBeCloseTo(300 / 18, 5);
    expect(r.clutchAttempts).toBe(1);
    expect(r.clutchWins).toBe(1);
    expect(r.clutchWinRate).toBe(1);
  });

  it("多行统计：数据累加正确", () => {
    const stats: PlayerStatRow[] = [
      {
        kills: 10, deaths: 5, assists: 3,
        adr: 100, kast: 80,
        firstKillCount: 2, firstDeathCount: 1,
        tradeKillCount: 1, tradeDeathCount: 0,
        oneKillCount: 5, twoKillCount: 2, threeKillCount: 1,
        fourKillCount: 0, fiveKillCount: 0,
        vsOneCount: 1, vsOneWonCount: 1,
        vsTwoCount: 0, vsTwoWonCount: 0,
        vsThreeCount: 0, vsThreeWonCount: 0,
        vsFourCount: 0, vsFourWonCount: 0,
        vsFiveCount: 0, vsFiveWonCount: 0,
        utilityDamage: 300,
        averageUtilityDamagePerRound: 16.7,
        wallbangKillCount: 0, noScopeKillCount: 0, collateralKillCount: 0,
      },
      {
        kills: 8, deaths: 10, assists: 2,
        adr: 60, kast: 60,
        firstKillCount: 1, firstDeathCount: 3,
        tradeKillCount: 0, tradeDeathCount: 0,
        oneKillCount: 4, twoKillCount: 1, threeKillCount: 0,
        fourKillCount: 0, fiveKillCount: 0,
        vsOneCount: 0, vsOneWonCount: 0,
        vsTwoCount: 1, vsTwoWonCount: 0,
        vsThreeCount: 0, vsThreeWonCount: 0,
        vsFourCount: 0, vsFourWonCount: 0,
        vsFiveCount: 0, vsFiveWonCount: 0,
        utilityDamage: 100,
        averageUtilityDamagePerRound: 5,
        wallbangKillCount: 0, noScopeKillCount: 0, collateralKillCount: 0,
      },
    ];
    const r = aggregatePlayerDemoStats(stats);
    expect(r.totalRounds).toBe(38); // 18+20
    // KAST 加权: (80*18+60*20)/38 ≈ 69.47
    expect(r.kast).toBeCloseTo((80 * 18 + 60 * 20) / 38, 2);
    // ADR 加权: (100*18+60*20)/38 ≈ 78.95
    expect(r.adr).toBeCloseTo((100 * 18 + 60 * 20) / 38, 2);
    expect(r.firstKillCount).toBe(3);
    expect(r.firstDeathCount).toBe(4);
    expect(r.entrySuccessRate).toBeCloseTo(3 / 7, 5);
    // multiKill = 2+1+1 = 4
    expect(r.multiKillRate).toBeCloseTo(4 / 38, 5);
    // 残局: vsOne 1W0L + vsTwo 0W1L = 1/2
    expect(r.clutchAttempts).toBe(2);
    expect(r.clutchWins).toBe(1);
    expect(r.clutchWinRate).toBe(0.5);

    expect(r.vsOne).toEqual({ count: 1, won: 1 });
    expect(r.vsTwo).toEqual({ count: 1, won: 0 });
  });

  it("致盲统计", () => {
    const stats: PlayerStatRow[] = [{
      kills: 1, deaths: 0, assists: 0,
      adr: 50, kast: 100,
      firstKillCount: 0, firstDeathCount: 0,
      tradeKillCount: 0, tradeDeathCount: 0,      oneKillCount: 0, twoKillCount: 0, threeKillCount: 0,
      fourKillCount: 0, fiveKillCount: 0,
      vsOneCount: 0, vsOneWonCount: 0,
      vsTwoCount: 0, vsTwoWonCount: 0,
      vsThreeCount: 0, vsThreeWonCount: 0,
      vsFourCount: 0, vsFourWonCount: 0,
      vsFiveCount: 0, vsFiveWonCount: 0,
      utilityDamage: 0,
      averageUtilityDamagePerRound: 0,
      wallbangKillCount: 0, noScopeKillCount: 0, collateralKillCount: 0,
    }];

    const blinds: BlindsRow[] = [
      { flasherSteamId64: "u1", flashedSide: "ct", flasherSide: "t", durationSeconds: 3.5 },
      { flasherSteamId64: "u1", flashedSide: "t", flasherSide: "t", durationSeconds: 2.0 }, // 同队不算
    ];

    const r = aggregatePlayerDemoStats(stats, blinds);
    expect(r.blindsEnemies).toBe(1); // 只有第一条
    expect(r.blindsDuration).toBeCloseTo(3.5, 5);
  });
});
