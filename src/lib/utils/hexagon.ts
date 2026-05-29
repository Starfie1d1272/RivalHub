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

  // ── Demo 扩展维度 ──
  kast: number;             // KAST % (0-100)
  utilityDamagePr: number;  // utility damage per round
  firstKillRate: number;    // firstKill / totalRounds
  clutchWinRate: number;    // clutches won / clutches attempted
  tradeKillRate: number;    // tradeKill / totalRounds
  entrySuccessRate: number; // firstKill / (firstKill + firstDeath)
  /** 是否有 demo 来源数据（用于权重重归一化）*/
  hasDemoData: boolean;
}

type MetricKey = keyof Omit<PlayerMetrics, "userId" | "totalRounds" | "hasDemoData">;

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
// demo 扩展维度权重在对应维度中加入

export const DIMENSION_WEIGHTS = Object.freeze({
  firepower:   Object.freeze({ kpr: 0.40, adr: 0.35, mkpr: 0.15, kd: 0.10 }),
  opening:     Object.freeze({ fkpr: 0.50, firstKillRate: 0.15, entrySuccessRate: 0.10, we: 0.20, adr: 0.05 }),
  multikill:   Object.freeze({ mkpr: 0.70, kpr: 0.20, adr: 0.10 }),
  clutch:      Object.freeze({ cpr: 0.45, clutchWinRate: 0.25, rws: 0.15, kd: 0.15 }),
  support:     Object.freeze({ apr: 0.30, kda: 0.15, kast: 0.20, utilityDamagePr: 0.10, tradeKillRate: 0.10, we: 0.10, rws: 0.05 }),
  consistency: Object.freeze({ ratingPro: 0.30, dprInverse: 0.25, kast: 0.15, kd: 0.10, tradeKillRate: 0.10, rws: 0.10 }),
});

// 各维度中属于 demo-only 的子指标（无 demo 数据时需从权重中移除并重归一化）
const DEMO_ONLY_METRICS_PER_DIM = {
  firepower:   [] as string[],
  opening:     ["firstKillRate", "entrySuccessRate"],
  multikill:   [] as string[],
  clutch:      ["clutchWinRate"],
  support:     ["kast", "utilityDamagePr", "tradeKillRate"],
  consistency: ["kast", "tradeKillRate"],
} as const satisfies Record<keyof typeof DIMENSION_WEIGHTS, readonly string[]>;

/** 针对某维度按 hasDemoData 计算加权分 */
function dimScore(
  weights: Record<string, number>,
  z: Record<string, number>,
  demoOnlyKeys: readonly string[],
  hasDemoData: boolean,
): number {
  if (hasDemoData) {
    return Object.entries(weights).reduce((s, [k, w]) => s + w * (z[k] ?? 50), 0);
  }
  // 无 demo 数据：移除 demo-only 子指标，将其权重重归一化到 OCR 子指标
  const demoSet = new Set(demoOnlyKeys);
  const ocrEntries = Object.entries(weights).filter(([k]) => !demoSet.has(k));
  const totalOcrWeight = ocrEntries.reduce((s, [, w]) => s + w, 0);
  if (totalOcrWeight < 1e-9) return 50;
  return ocrEntries.reduce((s, [k, w]) => s + (w / totalOcrWeight) * (z[k] ?? 50), 0);
}

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
  return clamp(50 + ((value - mean) / std) * 22);
}

/** Z-score 反向标准化：低值 → 高分（少死分专用） */
function zScoreInverse(value: number, mean: number, std: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(std) || std < 1e-9) {
    return 50;
  }
  return clamp(50 + ((mean - value) / std) * 22);
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
  "kast", "utilityDamagePr", "firstKillRate", "clutchWinRate", "tradeKillRate", "entrySuccessRate",
] as const satisfies readonly MetricKey[];

type _MetricKeysExhaustive = Exclude<MetricKey, (typeof METRIC_KEYS)[number]> extends never
  ? true
  : ["METRIC_KEYS missing keys"];
const _checkMetricKeys: _MetricKeysExhaustive = true;

const DEMO_ONLY_METRIC_KEYS = new Set<string>([
  "kast", "utilityDamagePr", "firstKillRate", "clutchWinRate", "tradeKillRate", "entrySuccessRate",
]);

/**
 * 计算赛事统计量（mean + std），供多次调用复用。
 * std 使用总体标准差 sqrt(E[(x-μ)²])。
 * demo-only 指标只统计有 demo 数据的选手，避免大量 0 拉低均值。
 */
export function computeEventStats(players: PlayerMetrics[]): EventStats {
  const n = players.length;
  const demoPlayers = players.filter(p => p.hasDemoData);

  const mean = {} as Record<MetricKey, number>;
  const std  = {} as Record<MetricKey, number>;

  if (n === 0) {
    for (const key of METRIC_KEYS) { mean[key] = 0; std[key] = 0; }
    return { mean, std };
  }

  for (const key of METRIC_KEYS) {
    const pool = DEMO_ONLY_METRIC_KEYS.has(key) ? demoPlayers : players;
    if (pool.length === 0) { mean[key] = 0; std[key] = 0; continue; }
    const sum = pool.reduce((s, p) => s + p[key], 0);
    const avg = sum / pool.length;
    const variance = pool.reduce((s, p) => s + (p[key] - avg) ** 2, 0) / pool.length;
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
  const hasDemoData = player.hasDemoData;

  const firepower = shrink(
    dimScore(DIMENSION_WEIGHTS.firepower as Record<string, number>, z, DEMO_ONLY_METRICS_PER_DIM.firepower, hasDemoData),
    rounds,
  );
  const opening = shrink(
    dimScore(DIMENSION_WEIGHTS.opening as Record<string, number>, z, DEMO_ONLY_METRICS_PER_DIM.opening, hasDemoData),
    rounds,
  );
  const multikill = shrink(
    dimScore(DIMENSION_WEIGHTS.multikill as Record<string, number>, z, DEMO_ONLY_METRICS_PER_DIM.multikill, hasDemoData),
    rounds,
  );
  const clutch = shrink(
    dimScore(DIMENSION_WEIGHTS.clutch as Record<string, number>, z, DEMO_ONLY_METRICS_PER_DIM.clutch, hasDemoData),
    rounds,
  );
  const support = shrink(
    dimScore(DIMENSION_WEIGHTS.support as Record<string, number>, z, DEMO_ONLY_METRICS_PER_DIM.support, hasDemoData),
    rounds,
  );
  const consistency = shrink(
    dimScore(DIMENSION_WEIGHTS.consistency as Record<string, number>, z, DEMO_ONLY_METRICS_PER_DIM.consistency, hasDemoData),
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
