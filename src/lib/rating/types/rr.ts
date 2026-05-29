/**
 * RR（Rival Rating）标量评分
 *
 * 设计原则：
 *  - 绝对刻度，1.00 ≈ 联赛平均水平（由 anchor 配置决定）
 *  - 第一场就有意义，不需要冷启动
 *  - Layer 1：上下文加权（eco 乘子 + 情境权重）
 *  - Layer 2：Round Swing / WPA（待数据量 ~1000 张图后开启）
 *  - 所有系数外置到版本化 config，公式形状稳定
 */

// ─── 权重 schema ──────────────────────────────────────────────────────────

export interface RRWeightsBase {
  /** KAST 系数 */
  kastCoef: number;
  /** KPR 系数 */
  kprCoef: number;
  /** DPR 系数（通常为负） */
  dprCoef: number;
  /** Impact 内的 KPR 权重 */
  impactKprWeight: number;
  /** Impact 内的 APR 权重 */
  impactAprWeight: number;
  /** Impact 内截距 */
  impactIntercept: number;
  /** Impact 整体系数 */
  impactCoef: number;
  /** ADR 系数 */
  adrCoef: number;
  /** 公式截距 */
  intercept: number;
}

export interface RREcoMultipliers {
  /**
   * eco 局击杀乘子：eco 局打出的 KPR/ADR 等价折算
   * 1.0 = 不激活；待用几十张图校准后调整
   */
  ecoKillMultiplier: number;
  forceKillMultiplier: number;
  fullBuyKillMultiplier: number;
  /**
   * eco 手枪打赢满配的额外奖励乘子
   * 1.0 = 不激活
   */
  ecoVsFullBonus: number;
}

export interface RRLayer2 {
  /**
   * Round Swing 系数
   * 0.0 = 关闭 Layer 2（当前默认）
   */
  roundSwingCoef: number;
  note?: string;
}

export interface RRClamp {
  min: number;
  max: number;
}

export interface RRAnchor {
  /**
   * "league_mean"：1.00 = 本赛季联赛均值
   * "pro_mean"：1.00 = 职业选手均值（更硬核，分数整体偏低）
   */
  mode: "league_mean" | "pro_mean";
  note?: string;
}

export interface RRWeights {
  /** 格式：rr-X.Y */
  version: string;
  description?: string;
  base: RRWeightsBase;
  ecoMultipliers: RREcoMultipliers;
  layer2: RRLayer2;
  clamp: RRClamp;
  anchor: RRAnchor;
}

// ─── 计算结果 ─────────────────────────────────────────────────────────────

export interface RRResult {
  /** 最终 RR 分（已 clamp） */
  rr: number;
  /** Layer 1 基础分（未 clamp，调试用） */
  rrBase: number;
  /** Layer 2 Round Swing 贡献（当前为 0） */
  rrSwing: number;
  /** 使用的权重版本 */
  weightsVersion: string;
  /** 各分项（调试 / 可解释性） */
  breakdown: {
    kastTerm: number;
    kprTerm: number;
    dprTerm: number;
    impactTerm: number;
    adrTerm: number;
    intercept: number;
  };
}
