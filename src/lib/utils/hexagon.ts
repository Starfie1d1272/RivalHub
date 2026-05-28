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
// demo 扩展维度权重在对应维度中加入

export const DIMENSION_WEIGHTS = Object.freeze({
  firepower:   Object.freeze({ kpr: 0.40, adr: 0.35, mkpr: 0.15, kd: 0.10 }),
  opening:     Object.freeze({ fkpr: 0.50, firstKillRate: 0.15, entrySuccessRate: 0.10, we: 0.20, adr: 0.05 }),
  multikill:   Object.freeze({ mkpr: 0.70, kpr: 0.20, adr: 0.10 }),
  clutch:      Object.freeze({ cpr: 0.45, clutchWinRate: 0.25, rws: 0.15, kd: 0.15 }),
  support:     Object.freeze({ apr: 0.30, kda: 0.15, kast: 0.20, utilityDamagePr: 0.10, tradeKillRate: 0.10, we: 0.10, rws: 0.05 }),
  consistency: Object.freeze({ ratingPro: 0.30, dprInverse: 0.25, kast: 0.15, kd: 0.10, tradeKillRate: 0.10, rws: 0.10 }),
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

  // 加权求和 + 收缩 (权重来自 DIMENSION_WEIGHTS)
  // 注意：泛型维度权重使用 Record<string, number> 避免 ts 编译时 key 约束
  const fw = DIMENSION_WEIGHTS.firepower as Record<string, number>;
  const firepower = shrink(
    fw.kpr  * z.kpr  +
    fw.adr  * z.adr  +
    fw.kd   * z.kd   +
    fw.mkpr * z.mkpr,
    rounds,
  );

  const ow = DIMENSION_WEIGHTS.opening as Record<string, number>;
  const opening = shrink(
    ow.fkpr           * z.fkpr +
    ow.we             * z.we   +
    ow.adr            * z.adr  +
    ow.firstKillRate  * (z.firstKillRate ?? 50) +
    ow.entrySuccessRate * (z.entrySuccessRate ?? 50),
    rounds,
  );

  const mw = DIMENSION_WEIGHTS.multikill as Record<string, number>;
  const multikill = shrink(
    mw.mkpr * z.mkpr +
    mw.kpr  * z.kpr  +
    mw.adr  * z.adr,
    rounds,
  );

  const cw = DIMENSION_WEIGHTS.clutch as Record<string, number>;
  const clutch = shrink(
    cw.cpr          * z.cpr +
    cw.clutchWinRate * (z.clutchWinRate ?? 50) +
    cw.kd           * z.kd  +
    cw.rws          * z.rws,
    rounds,
  );

  const sw = DIMENSION_WEIGHTS.support as Record<string, number>;
  const support = shrink(
    sw.apr             * z.apr +
    sw.kda             * z.kda +
    sw.we              * z.we  +
    sw.rws             * z.rws +
    sw.kast            * (z.kast ?? 50) +
    sw.utilityDamagePr * (z.utilityDamagePr ?? 50) +
    sw.tradeKillRate   * (z.tradeKillRate ?? 50),
    rounds,
  );

  const ctw = DIMENSION_WEIGHTS.consistency as Record<string, number>;
  const consistency = shrink(
    ctw.ratingPro     * z.ratingPro  +
    ctw.dprInverse    * z.dprInverse +
    ctw.rws           * z.rws        +
    ctw.kd            * z.kd         +
    ctw.kast          * (z.kast ?? 50) +
    ctw.tradeKillRate * (z.tradeKillRate ?? 50),
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
