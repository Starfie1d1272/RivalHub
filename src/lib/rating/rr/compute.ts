/**
 * RR 标量计算——Layer 1（上下文加权）
 *
 * 当前实现：HLTV 2.0 逆向公式（社区版 R²≈0.995）作为过渡基础。
 * Layer 2（Round Swing）接口已预留，roundSwingCoef=0 时完全透明。
 *
 * 替换指南：
 *   1. 修改 rr-v1.json 中的系数，无需改动此文件
 *   2. 启用 eco 乘子：先用自有赛事 ~50 张图回归校准，再更新 ecoMultipliers
 *   3. 启用 Layer 2：等 ~1000 张图训好模型后，将 roundSwingCoef 设为非零值
 */

import type { RRIndicators } from "../types/indicators";
import type { RRWeights, RRResult } from "../types/rr";

/**
 * 计算单名选手单张地图的 RR 分。
 *
 * 纯函数，无副作用。
 */
export function computeRR(
  ind: RRIndicators,
  weights: RRWeights,
): RRResult {
  if (ind.totalRounds <= 0) {
    return zeroResult(weights.version);
  }

  const { base, ecoMultipliers, layer2, clamp } = weights;

  // ── Layer 1：基础公式 ──────────────────────────────────────────────────
  // Impact 子项
  const impact =
    base.impactKprWeight * ind.kpr +
    base.impactAprWeight * ind.apr +
    base.impactIntercept;

  // 各分项（保留用于 breakdown / 可解释性）
  const kastTerm   = base.kastCoef   * ind.kast;
  const kprTerm    = base.kprCoef    * ind.kpr;
  const dprTerm    = base.dprCoef    * ind.dpr;
  const impactTerm = base.impactCoef * impact;
  const adrTerm    = base.adrCoef    * ind.adr;

  let rrBase =
    kastTerm + kprTerm + dprTerm + impactTerm + adrTerm + base.intercept;

  // ── eco 上下文乘子（当前 ecoMultipliers 全为 1.0，不改变结果）─────────
  const totalCategorized =
    ind.ecoRoundCount + ind.forceRoundCount +
    ind.fullBuyRoundCount + ind.pistolRoundCount;

  if (totalCategorized > 0) {
    const ecoFrac   = ind.ecoRoundCount   / totalCategorized;
    const forceFrac = ind.forceRoundCount / totalCategorized;
    const fullFrac  = ind.fullBuyRoundCount / totalCategorized;
    const ecoAdjust =
      ecoFrac   * ecoMultipliers.ecoKillMultiplier +
      forceFrac * ecoMultipliers.forceKillMultiplier +
      fullFrac  * ecoMultipliers.fullBuyKillMultiplier +
      (1 - ecoFrac - forceFrac - fullFrac);

    const killTerms = kprTerm + impactTerm;
    rrBase = rrBase - killTerms + killTerms * ecoAdjust;
  }

  // ── Layer 2：Round Swing（当前 coef=0，透明透传）──────────────────────
  const rrSwing =
    layer2.roundSwingCoef * (ind.roundSwingPerKill ?? 0) * ind.kpr;

  const rrRaw = rrBase + rrSwing;
  const rr    = Math.max(clamp.min, Math.min(clamp.max, rrRaw));

  return {
    rr,
    rrBase,
    rrSwing,
    weightsVersion: weights.version,
    breakdown: {
      kastTerm,
      kprTerm,
      dprTerm,
      impactTerm,
      adrTerm,
      intercept: base.intercept,
    },
  };
}

// ─── 工具 ─────────────────────────────────────────────────────────────────

function zeroResult(version: string): RRResult {
  return {
    rr: 1.0,
    rrBase: 1.0,
    rrSwing: 0,
    weightsVersion: version,
    breakdown: {
      kastTerm: 0, kprTerm: 0, dprTerm: 0,
      impactTerm: 0, adrTerm: 0, intercept: 0,
    },
  };
}

/**
 * 从 RRResult[] 数组计算联赛均值，用于将绝对分锚定到 1.00。
 *
 * 当 anchor.mode === "league_mean" 时，调用方应将所有选手的 rr
 * 再乘以 (1.0 / leagueMeanRR) 完成归一。
 */
export function computeLeagueMean(results: RRResult[]): number {
  if (results.length === 0) return 1.0;
  const sum = results.reduce((acc, r) => acc + r.rr, 0);
  return sum / results.length;
}
