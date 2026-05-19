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
  it("std=0 时（所有选手所有指标完全相同）六维各维应为 50", () => {
    // 两名选手所有指标完全相同 → 每个指标 std=0 → 每个 zScore 返回 50 → 六维均为 50
    const identical = {
      kpr: 0.8, dpr: 0.7, apr: 0.4, kd: 1.1, kda: 1.5,
      fkpr: 0.1, mkpr: 0.15, cpr: 0.05, adr: 80,
      rws: 0.25, we: 0.5, ratingPro: 1.0, totalRounds: 60,
    };
    const p1 = makePlayer({ userId: "u1", ...identical });
    const p2 = makePlayer({ userId: "u2", ...identical });
    const stats = computeEventStats([p1, p2]);

    // 验证所有 std 确实为 0
    for (const key of Object.keys(stats.std) as (keyof typeof stats.std)[]) {
      expect(stats.std[key], `std.${key} 应为 0`).toBeCloseTo(0);
    }

    const s1 = computeDimensions(p1, stats);
    const s2 = computeDimensions(p2, stats);

    const dims: (keyof HexagonScores)[] = ["firepower", "opening", "multikill", "clutch", "support", "consistency"];
    for (const dim of dims) {
      expect(s1[dim], `s1.${dim} 应为 50`).toBeCloseTo(50);
      expect(s2[dim], `s2.${dim} 应为 50`).toBeCloseTo(50);
    }
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

  it("所有指标均等于 mean 的选手六维应接近 50", () => {
    // 构造镜像对：每个指标互为关于中点对称
    const p1 = makePlayer({
      userId: "low",
      kpr: 0.4, dpr: 0.4, apr: 0.2, kd: 0.7, kda: 1.0,
      fkpr: 0.05, mkpr: 0.05, cpr: 0.02, adr: 60,
      rws: 0.15, we: 0.3, ratingPro: 0.7,
    });
    const p2 = makePlayer({
      userId: "high",
      kpr: 1.2, dpr: 0.8, apr: 0.6, kd: 1.5, kda: 2.0,
      fkpr: 0.15, mkpr: 0.25, cpr: 0.08, adr: 100,
      rws: 0.35, we: 0.7, ratingPro: 1.3,
    });
    const stats = computeEventStats([p1, p2]);
    // 中点选手所有指标恰好等于 mean
    const mid = makePlayer({
      userId: "mid",
      kpr: 0.8, dpr: 0.6, apr: 0.4, kd: 1.1, kda: 1.5,
      fkpr: 0.10, mkpr: 0.15, cpr: 0.05, adr: 80,
      rws: 0.25, we: 0.5, ratingPro: 1.0,
      totalRounds: 60,
    });
    const scores = computeDimensions(mid, stats);
    for (const key of Object.keys(scores) as (keyof HexagonScores)[]) {
      expect(scores[key], `${key} 应接近 50`).toBeCloseTo(50, 0);
    }
  });

  it("totalRounds=0 时六维应全部为 50（完全归中性）", () => {
    const p = makePlayer({ userId: "zero", totalRounds: 0 });
    const stats = computeEventStats([p]);
    const scores = computeDimensions(p, stats);
    for (const key of Object.keys(scores) as (keyof HexagonScores)[]) {
      expect(scores[key], `${key} 应为 50`).toBeCloseTo(50);
    }
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
