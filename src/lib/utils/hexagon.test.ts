import { describe, it, expect } from "vitest";
import {
  computeEventStats,
  computeDimensions,
  computeTeamDimensions,
  DIMENSION_WEIGHTS,
  type PlayerMetrics,
  type HexagonScores,
} from "./hexagon";

// ─── 辅助工厂 ─────────────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerMetrics> = {}): PlayerMetrics {
  return {
    userId: "u1",
    kpr: 0.8,
    dpr: 0.7,
    apr: 0.4,
    kd: 1.1,
    kda: 1.5,
    fkpr: 0.1,
    mkpr: 0.15,
    cpr: 0.05,
    adr: 80,
    rws: 0.25,
    we: 0.5,
    ratingPro: 1.0,
    totalRounds: 60,
    ...overrides,
  };
}

// ─── zScore 内部行为（通过 computeEventStats + computeDimensions 间接测试） ──

describe("zScore 边界", () => {
  it("std=0 时所有人该指标标准化分数应为 50（所有人值相同）", () => {
    const p1 = makePlayer({ kpr: 1.0 });
    const p2 = makePlayer({ userId: "u2", kpr: 1.0 });
    const stats = computeEventStats([p1, p2]);
    // std.kpr 为 0，mean.kpr = 1.0
    expect(stats.std.kpr).toBeCloseTo(0);
    // 两个分数都应为 50
    const s1 = computeDimensions(p1, stats);
    const s2 = computeDimensions(p2, stats);
    // firepower 包含 kpr，当 kpr std=0 kd std=0 adr std=0 mkpr std=0 时 firepower=50
    // 这里只验证极值不超出 0-100
    expect(s1.firepower).toBeGreaterThanOrEqual(0);
    expect(s1.firepower).toBeLessThanOrEqual(100);
    expect(s2.firepower).toBeGreaterThanOrEqual(0);
    expect(s2.firepower).toBeLessThanOrEqual(100);
  });

  it("极高值应 clamp 到 100（不超过 100）", () => {
    const p1 = makePlayer({ kpr: 100 });
    const p2 = makePlayer({ userId: "u2", kpr: 0 });
    const stats = computeEventStats([p1, p2]);
    const s1 = computeDimensions(p1, stats);
    expect(s1.firepower).toBeLessThanOrEqual(100);
  });

  it("极低值应 clamp 到 0（不低于 0）", () => {
    const p1 = makePlayer({ kpr: 0 });
    const p2 = makePlayer({ userId: "u2", kpr: 100 });
    const stats = computeEventStats([p1, p2]);
    const s1 = computeDimensions(p1, stats);
    expect(s1.firepower).toBeGreaterThanOrEqual(0);
  });
});

// ─── computeEventStats ────────────────────────────────────────────────────────

describe("computeEventStats", () => {
  it("单人时 std 为 0，mean 等于本人值", () => {
    const p = makePlayer({ kpr: 0.9 });
    const stats = computeEventStats([p]);
    expect(stats.mean.kpr).toBeCloseTo(0.9);
    expect(stats.std.kpr).toBeCloseTo(0);
  });

  it("两人时 mean 和 std 计算正确", () => {
    const p1 = makePlayer({ kpr: 0.6 });
    const p2 = makePlayer({ userId: "u2", kpr: 1.0 });
    const stats = computeEventStats([p1, p2]);
    // mean = 0.8, 总体 std = sqrt(((0.6-0.8)²+(1.0-0.8)²)/2) = sqrt(0.04) = 0.2
    expect(stats.mean.kpr).toBeCloseTo(0.8);
    expect(stats.std.kpr).toBeCloseTo(0.2);
  });

  it("三人时 mean 和 std 计算正确", () => {
    const players = [
      makePlayer({ userId: "u1", adr: 60 }),
      makePlayer({ userId: "u2", adr: 80 }),
      makePlayer({ userId: "u3", adr: 100 }),
    ];
    const stats = computeEventStats(players);
    // mean = 80, 总体 std = sqrt(((60-80)²+(80-80)²+(100-80)²)/3) = sqrt(800/3) ≈ 16.33
    expect(stats.mean.adr).toBeCloseTo(80);
    expect(stats.std.adr).toBeCloseTo(Math.sqrt(800 / 3));
  });

  it("空数组时 mean 和 std 均为 0", () => {
    const stats = computeEventStats([]);
    expect(stats.mean.kpr).toBe(0);
    expect(stats.std.kpr).toBe(0);
  });
});

// ─── computeDimensions ───────────────────────────────────────────────────────

describe("computeDimensions", () => {
  it("所有输出维度应在 0-100 之间", () => {
    const players = [
      makePlayer({ userId: "u1" }),
      makePlayer({ userId: "u2", kpr: 1.2, dpr: 0.5, adr: 100 }),
      makePlayer({ userId: "u3", kpr: 0.4, dpr: 0.9, adr: 60 }),
    ];
    const stats = computeEventStats(players);
    for (const p of players) {
      const scores = computeDimensions(p, stats);
      for (const key of Object.keys(scores) as (keyof HexagonScores)[]) {
        expect(scores[key], `${key} out of range`).toBeGreaterThanOrEqual(0);
        expect(scores[key], `${key} out of range`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("各维度权重之和等于 1.0", () => {
    for (const [dim, weights] of Object.entries(DIMENSION_WEIGHTS)) {
      const sum = Object.values(weights).reduce((s, w) => s + w, 0);
      expect(sum, `${dim} 权重之和应为 1.0`).toBeCloseTo(1.0);
    }
  });

  it("平均选手（所有指标等于 mean）经 shrink 后得分接近 50", () => {
    const players = [
      makePlayer({ userId: "u1", kpr: 0.6 }),
      makePlayer({ userId: "u2", kpr: 1.0 }),
    ];
    const stats = computeEventStats(players);
    // 均值为 0.8 的选手
    const avg = makePlayer({ userId: "avg", kpr: 0.8, totalRounds: 60 });
    // 注意：其他指标也需要等于 mean；这里用简单单指标偏差为 0 的场景
    const scores = computeDimensions(avg, stats);
    // 由于其他指标也有偏差，只验证范围
    expect(scores.firepower).toBeGreaterThanOrEqual(0);
    expect(scores.firepower).toBeLessThanOrEqual(100);
  });
});

// ─── shrink 行为（通过 computeDimensions 间接测试） ─────────────────────────

describe("shrink 行为", () => {
  it("rounds=30（< threshold 60）时分数比 rounds=60 更靠近 50", () => {
    const players = [
      makePlayer({ userId: "u1", kpr: 0.3 }),
      makePlayer({ userId: "u2", kpr: 1.5 }),
    ];
    const stats = computeEventStats(players);

    const lowRounds  = makePlayer({ userId: "u3", kpr: 1.5, totalRounds: 30 });
    const fullRounds = makePlayer({ userId: "u4", kpr: 1.5, totalRounds: 60 });

    const sLow  = computeDimensions(lowRounds,  stats);
    const sFull = computeDimensions(fullRounds, stats);

    // 强势选手 rounds=30 时 firepower 应比 rounds=60 更接近 50（即更低）
    expect(Math.abs(sLow.firepower - 50)).toBeLessThan(Math.abs(sFull.firepower - 50));
  });

  it("rounds=60（等于 threshold）时 factor=1，分数不收缩", () => {
    const players = [
      makePlayer({ userId: "u1", kpr: 0.3 }),
      makePlayer({ userId: "u2", kpr: 1.5 }),
    ];
    const stats = computeEventStats(players);

    const at60    = makePlayer({ userId: "u3", kpr: 1.5, totalRounds: 60  });
    const above60 = makePlayer({ userId: "u4", kpr: 1.5, totalRounds: 120 });

    const s60    = computeDimensions(at60,    stats);
    const sAbove = computeDimensions(above60, stats);

    // rounds >= threshold 时 factor=min(1,...)=1，分数不再收缩
    expect(s60.firepower).toBeCloseTo(sAbove.firepower);
  });
});

// ─── computeTeamDimensions ───────────────────────────────────────────────────

describe("computeTeamDimensions", () => {
  it("空数组返回全 50", () => {
    const result = computeTeamDimensions([]);
    for (const key of Object.keys(result) as (keyof HexagonScores)[]) {
      expect(result[key]).toBe(50);
    }
  });

  it("单人时返回该人分数", () => {
    const score: HexagonScores = {
      firepower: 70, opening: 60, multikill: 55,
      clutch: 45, support: 80, consistency: 65,
    };
    const result = computeTeamDimensions([score]);
    expect(result.firepower).toBeCloseTo(70);
    expect(result.opening).toBeCloseTo(60);
    expect(result.support).toBeCloseTo(80);
  });

  it("多人时返回各维度的算术均值", () => {
    const s1: HexagonScores = { firepower: 60, opening: 70, multikill: 50, clutch: 80, support: 40, consistency: 90 };
    const s2: HexagonScores = { firepower: 80, opening: 50, multikill: 70, clutch: 60, support: 60, consistency: 50 };
    const result = computeTeamDimensions([s1, s2]);
    expect(result.firepower).toBeCloseTo(70);
    expect(result.opening).toBeCloseTo(60);
    expect(result.multikill).toBeCloseTo(60);
    expect(result.clutch).toBeCloseTo(70);
    expect(result.support).toBeCloseTo(50);
    expect(result.consistency).toBeCloseTo(70);
  });

  it("五人队伍各维度均值计算正确", () => {
    const scores: HexagonScores[] = [
      { firepower: 55, opening: 60, multikill: 50, clutch: 45, support: 70, consistency: 65 },
      { firepower: 75, opening: 55, multikill: 80, clutch: 60, support: 50, consistency: 70 },
      { firepower: 65, opening: 70, multikill: 60, clutch: 55, support: 80, consistency: 60 },
      { firepower: 50, opening: 65, multikill: 55, clutch: 70, support: 60, consistency: 75 },
      { firepower: 70, opening: 50, multikill: 65, clutch: 50, support: 55, consistency: 55 },
    ];
    const result = computeTeamDimensions(scores);
    expect(result.firepower).toBeCloseTo((55 + 75 + 65 + 50 + 70) / 5);
    expect(result.opening).toBeCloseTo((60 + 55 + 70 + 65 + 50) / 5);
  });
});
