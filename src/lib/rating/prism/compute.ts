/**
 * PRISM 八维画像计算
 *
 * 输入：赛季内所有选手的 RRIndicators 数组（批次计算，需要完整队列做 z-score）
 * 输出：每名选手的 PrismResult（含八轴百分位 + RR 百分位）
 *
 * 流程：
 *   1. 对每名选手、每根轴，提取 involvementRaw / efficiencyRaw
 *   2. 跨选手做 z-score（批次内相对）
 *   3. 融合：axis_z = α·z_inv + (1-α)·z_eff
 *   4. 冷启动收缩：z' = z · n/(n+k)
 *   5. 转百分位（经验排名，样本小时退化到正态 CDF）
 */

import type { RRIndicators } from "../types/indicators";
import type {
  PrismWeights,
  PrismAxisKey,
  PrismAxisResult,
  PrismResult,
} from "../types/prism";
import { PRISM_AXES } from "../types/prism";
import { extractAxisScore } from "./extract";
import { zScoreAll, coldStartShrink, zToPercentile } from "./zscore";

export interface PrismComputeInput {
  indicators: RRIndicators;
  /** 该选手参与的地图数（冷启动收缩依据） */
  mapCount: number;
  /** RR 百分位（0–100），由调用方计算后传入 */
  rrPercentile: number;
}

/**
 * 计算整个赛季批次的 PRISM 结果。
 *
 * @param cohort   赛季内所有选手的输入数据
 * @param weights  PRISM 权重配置
 */
export function computePrism(
  cohort: PrismComputeInput[],
  weights: PrismWeights,
): PrismResult[] {
  if (cohort.length === 0) return [];

  const { coldStartK, axes } = weights;

  // ── Step 1: 每名选手、每根轴提取原始分 ──────────────────────────────
  const rawInv: Record<PrismAxisKey, number[]> = {} as never;
  const rawEff: Record<PrismAxisKey, number[]> = {} as never;

  for (const axis of PRISM_AXES) {
    rawInv[axis] = [];
    rawEff[axis] = [];
  }

  for (const entry of cohort) {
    for (const axis of PRISM_AXES) {
      const cfg = axes[axis];
      rawInv[axis].push(extractAxisScore(entry.indicators, cfg.involvement));
      rawEff[axis].push(extractAxisScore(entry.indicators, cfg.efficiency));
    }
  }

  // ── Step 2: 跨选手 z-score ───────────────────────────────────────────
  const zInv: Record<PrismAxisKey, number[]> = {} as never;
  const zEff: Record<PrismAxisKey, number[]> = {} as never;

  for (const axis of PRISM_AXES) {
    zInv[axis] = zScoreAll(rawInv[axis]);
    zEff[axis] = zScoreAll(rawEff[axis]);
  }

  // ── Step 3+4+5: 融合、收缩、转百分位 ────────────────────────────────
  const fusedZ: Record<PrismAxisKey, number[]> = {} as never;
  for (const axis of PRISM_AXES) {
    const alpha = axes[axis].alpha;
    fusedZ[axis] = cohort.map((_, i) => {
      const zi = alpha * (zInv[axis][i] ?? 0) + (1 - alpha) * (zEff[axis][i] ?? 0);
      return coldStartShrink(zi, cohort[i]?.mapCount ?? 1, coldStartK);
    });
  }

  // ── 组装结果 ─────────────────────────────────────────────────────────
  return cohort.map((entry, i) => {
    const axisResults = {} as Record<PrismAxisKey, PrismAxisResult>;

    for (const axis of PRISM_AXES) {
      const z = fusedZ[axis][i] ?? 0;
      const invRaw = rawInv[axis][i] ?? 0;
      const effRaw = rawEff[axis][i] ?? 0;
      // 无原始信号（如从未用 AWP）→ 该风格维度直接为 0，不参与百分位排名
      const percentile = (invRaw === 0 && effRaw === 0)
        ? 0
        : zToPercentile(z, fusedZ[axis]);
      axisResults[axis] = {
        involvementRaw: invRaw,
        efficiencyRaw:  effRaw,
        z,
        percentile,
      };
    }

    return {
      steamId64:      entry.indicators.steamId64,
      weightsVersion: weights.version,
      mapCount:       entry.mapCount,
      rrPercentile:   entry.rrPercentile,
      axes:           axisResults,
    } satisfies PrismResult;
  });
}

/**
 * 从 RR 分数组计算经验百分位，供调用方构造 PrismComputeInput.rrPercentile。
 *
 * @param rrScores   所有选手的最终 RR 分（已锚定到联赛均值）
 * @param targetRR   目标选手的 RR 分
 */
export function rrToPercentile(rrScores: number[], targetRR: number): number {
  if (rrScores.length === 0) return 50;
  const sorted = [...rrScores].sort((a, b) => a - b);
  let pos = 0;
  for (const v of sorted) {
    if (v <= targetRR) pos++;
    else break;
  }
  return (pos / sorted.length) * 100;
}
