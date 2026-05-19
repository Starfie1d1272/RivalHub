/**
 * 六维雷达图标准化计算工具
 *
 * 流程：原始指标 → Z-score 标准化 → 加权求和六维 → 小样本收缩
 */

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** 原始中间指标（每选手聚合后的值，单位：per-round 或 ratio） */
export interface PlayerMetrics {
  userId: string;
  kpr: number;       // kills per round
  dpr: number;       // deaths per round
  apr: number;       // assists per round
  kd: number;        // kills / max(deaths, 1)
  kda: number;       // (kills + assists) / max(deaths, 1)
  fkpr: number;      // first kills per round
  mkpr: number;      // multi kills per round
  cpr: number;       // clutches per round
  adr: number;       // avg damage per round (round-weighted)
  rws: number;       // round win share
  we: number;        // win equity
  ratingPro: number; // rating pro
  totalRounds: number; // 参与回合总数
}

type MetricKey = keyof Omit<PlayerMetrics, "userId" | "totalRounds">;

/** 赛事统计量（用于 Z-score） */
export interface EventStats {
  mean: Record<MetricKey, number>;
  std:  Record<MetricKey, number>;
}

/** 六维分数（0-100） */
export interface HexagonScores {
  firepower:   number;  // 火力
  opening:     number;  // 破局
  multikill:   number;  // 多杀
  clutch:      number;  // 残局
  support:     number;  // 协同
  consistency: number;  // 稳定
}

// ─── 六维权重配置 ─────────────────────────────────────────────────────────────

export const DIMENSION_WEIGHTS = Object.freeze({
  firepower:   Object.freeze({ kpr: 0.35, adr: 0.35, kd: 0.15, mkpr: 0.15 }),
  opening:     Object.freeze({ fkpr: 0.50, we: 0.30, adr: 0.20 }),
  multikill:   Object.freeze({ mkpr: 0.55, kpr: 0.25, adr: 0.20 }),
  clutch:      Object.freeze({ cpr: 0.55, kd: 0.25, rws: 0.20 }),
  support:     Object.freeze({ apr: 0.35, kda: 0.25, we: 0.20, rws: 0.20 }),
  consistency: Object.freeze({ ratingPro: 0.40, dprInverse: 0.30, rws: 0.20, kd: 0.10 }),
});

// ─── 内部标准化辅助函数 ───────────────────────────────────────────────────────

/** 将值 clamp 到 [0, 100] */
function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Z-score 标准化：高值 → 高分 */
function zScore(value: number, mean: number, std: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(std) || std < 1e-9) {
    return 50;
  }
  return clamp(50 + ((value - mean) / std) * 15);
}

/** Z-score 反向标准化：低值 → 高分（少死分专用） */
function zScoreInverse(value: number, mean: number, std: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(std) || std < 1e-9) {
    return 50;
  }
  return clamp(50 + ((mean - value) / std) * 15);
}

/** 小样本收缩：回合数不足 threshold 时向 50 靠拢 */
function shrink(score: number, rounds: number, threshold = 60): number {
  const factor = Math.min(1, rounds / threshold);
  return 50 + (score - 50) * factor;
}

// ─── 公开函数 ─────────────────────────────────────────────────────────────────

const METRIC_KEYS = [
  "kpr", "dpr", "apr", "kd", "kda",
  "fkpr", "mkpr", "cpr", "adr", "rws", "we", "ratingPro",
] as const satisfies readonly MetricKey[];

type _MetricKeysExhaustive = Exclude<MetricKey, (typeof METRIC_KEYS)[number]> extends never
  ? true
  : ["METRIC_KEYS missing keys"];
const _checkMetricKeys: _MetricKeysExhaustive = true;

/**
 * 计算赛事统计量（mean + std），供多次调用复用。
 * std 使用总体标准差 sqrt(E[(x-μ)²])。
 */
export function computeEventStats(players: PlayerMetrics[]): EventStats {
  const n = players.length;

  const mean = {} as Record<MetricKey, number>;
  const std  = {} as Record<MetricKey, number>;

  if (n === 0) {
    for (const key of METRIC_KEYS) { mean[key] = 0; std[key] = 0; }
    return { mean, std };
  }

  for (const key of METRIC_KEYS) {
    const sum = players.reduce((s, p) => s + p[key], 0);
    const avg = sum / n;
    const variance = players.reduce((s, p) => s + (p[key] - avg) ** 2, 0) / n;
    mean[key] = avg;
    std[key]  = Math.sqrt(variance);
  }

  return { mean, std };
}

/**
 * 计算单个选手六维分数（0-100）。
 * 步骤：
 *   1. 对每个原始指标做 Z-score（dpr 用反向）
 *   2. 按权重加权求和得六维原始分
 *   3. 对每维分数做小样本收缩
 */
export function computeDimensions(
  player: PlayerMetrics,
  stats: EventStats,
): HexagonScores {
  const { mean, std } = stats;

  // 预计算所有指标的标准化分数
  type ZKey = MetricKey | "dprInverse";
  const z = {} as Record<ZKey, number>;
  for (const key of METRIC_KEYS) {
    z[key] = zScore(player[key], mean[key], std[key]);
  }
  // dprInverse：少死分（反向）
  z.dprInverse = zScoreInverse(player.dpr, mean.dpr, std.dpr);

  const rounds = player.totalRounds;

  // 加权求和 + 收缩
  const firepower = shrink(
    DIMENSION_WEIGHTS.firepower.kpr  * z.kpr  +
    DIMENSION_WEIGHTS.firepower.adr  * z.adr  +
    DIMENSION_WEIGHTS.firepower.kd   * z.kd   +
    DIMENSION_WEIGHTS.firepower.mkpr * z.mkpr,
    rounds,
  );

  const opening = shrink(
    DIMENSION_WEIGHTS.opening.fkpr * z.fkpr +
    DIMENSION_WEIGHTS.opening.we   * z.we   +
    DIMENSION_WEIGHTS.opening.adr  * z.adr,
    rounds,
  );

  const multikill = shrink(
    DIMENSION_WEIGHTS.multikill.mkpr * z.mkpr +
    DIMENSION_WEIGHTS.multikill.kpr  * z.kpr  +
    DIMENSION_WEIGHTS.multikill.adr  * z.adr,
    rounds,
  );

  const clutch = shrink(
    DIMENSION_WEIGHTS.clutch.cpr * z.cpr +
    DIMENSION_WEIGHTS.clutch.kd  * z.kd  +
    DIMENSION_WEIGHTS.clutch.rws * z.rws,
    rounds,
  );

  const support = shrink(
    DIMENSION_WEIGHTS.support.apr * z.apr +
    DIMENSION_WEIGHTS.support.kda * z.kda +
    DIMENSION_WEIGHTS.support.we  * z.we  +
    DIMENSION_WEIGHTS.support.rws * z.rws,
    rounds,
  );

  const consistency = shrink(
    DIMENSION_WEIGHTS.consistency.ratingPro  * z.ratingPro  +
    DIMENSION_WEIGHTS.consistency.dprInverse * z.dprInverse +
    DIMENSION_WEIGHTS.consistency.rws        * z.rws        +
    DIMENSION_WEIGHTS.consistency.kd         * z.kd,
    rounds,
  );

  return { firepower, opening, multikill, clutch, support, consistency };
}

/**
 * 计算队伍六维（成员分数的算术均值）。
 * 空数组返回全 50。
 */
export function computeTeamDimensions(scores: HexagonScores[]): HexagonScores {
  if (scores.length === 0) {
    return { firepower: 50, opening: 50, multikill: 50, clutch: 50, support: 50, consistency: 50 };
  }
  const keys: (keyof HexagonScores)[] = ["firepower", "opening", "multikill", "clutch", "support", "consistency"];
  const result = {} as HexagonScores;
  for (const key of keys) {
    result[key] = scores.reduce((s, sc) => s + sc[key], 0) / scores.length;
  }
  return result;
}
