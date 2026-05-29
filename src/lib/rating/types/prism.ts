/**
 * PRISM — 八维风格画像
 *
 * 设计原则：
 *  - 形状（轴半径）= 风格指纹：这根轴伸多长代表"多大程度扮演这个角色"
 *  - 颜色 = RR 水平：整体着色绑定 RR 百分位，风格和水平双编码互不干扰
 *  - 每根轴 α 不同：风格/水平配比按角色本质浮动
 *  - 冷启动收缩：z' = z · n/(n+k)，仅作用于画像层，不碰 RR 标量
 *  - 所有系数外置，带版本号，零重构可换系数
 */
import type { RRIndicators } from "./indicators";

// ─── 八维枚举 ─────────────────────────────────────────────────────────────

export const PRISM_AXES = [
  "firepower",  // 火力：纯输出，不看生存
  "opening",    // 首杀：首杀对枪赢下来（成功侧）
  "clutch",     // 残局：1vX 残局，time-alive 型
  "sniping",    // 狙击：AWP 风格标签（近乎纯风格）
  "survival",   // 生存：活下来/低死亡率（近乎纯水平）
  "utility",    // 道具：投掷物贡献
  "trading",    // 补枪：补枪、护队友
  "entry",      // 突破：开路尖刀，第一个趟（与 opening 互补）
] as const;

export type PrismAxisKey = typeof PRISM_AXES[number];

/**
 * 八角形布局顺序（顺时针，用于前端渲染）
 * 对立角色放对角：opening ↔ clutch（早期 vs 后期），entry ↔ survival（送死 vs 保命）
 */
export const PRISM_AXIS_ORDER: PrismAxisKey[] = [
  "firepower",
  "opening",
  "clutch",
  "sniping",
  "survival",
  "utility",
  "trading",
  "entry",
];

// ─── 权重 schema ──────────────────────────────────────────────────────────

/** 单个信号配置 */
export interface SignalConfig {
  /** RRIndicators 的字段名 */
  signal: keyof RRIndicators;
  /** 在加权组合中的权重（同组内 weights 之和应为 1.0） */
  weight: number;
  /**
   * 是否反转（低值 = 好）
   * 例：dpr 越低越好，invert: true 后变成"低 dpr 得高分"
   */
  invert?: boolean;
}

/** 单根轴的配置 */
export interface PrismAxisConfig {
  /**
   * 风格/水平融合比例
   * 0 = 完全看效率/水平，1 = 完全看参与度/风格
   * 建议范围：0.2（生存）~ 0.85（狙击）
   */
  alpha: number;
  /**
   * 参与度信号（风格侧）：这根轴的"你做了多少"
   * z-score 后乘以 alpha
   */
  involvement: SignalConfig[];
  /**
   * 效率信号（水平侧）：这根轴的"你做得多好"
   * z-score 后乘以 (1 - alpha)
   */
  efficiency: SignalConfig[];
}

export interface PrismWeights {
  /** 格式：prism-X.Y */
  version: string;
  /**
   * 冷启动收缩常数 k
   * z_shown = z_raw · n / (n + k)
   * n = 该选手参与的地图数，k 约等于"几张图后分数才基本稳定"
   */
  coldStartK: number;
  /**
   * eco 上下文渗入效率项的强度
   * 0 = 不渗；保留旋钮，当前版本填 0
   */
  ecoTilt: number;
  /**
   * 颜色来源
   * "rr_percentile"：整体着色 = RR 百分位
   * "axis_efficiency"：每根轴用各自效率百分位做局部明暗（信息更丰富但复杂）
   */
  colorSource: "rr_percentile" | "axis_efficiency";
  axes: Record<PrismAxisKey, PrismAxisConfig>;
}

// ─── 计算结果 ─────────────────────────────────────────────────────────────

/** 单名选手单根轴的中间结果（调试用） */
export interface PrismAxisResult {
  /** 加权参与度原始分（未做 z-score） */
  involvementRaw: number;
  /** 加权效率原始分（未做 z-score） */
  efficiencyRaw: number;
  /** 融合后 z-score（已冷启动收缩） */
  z: number;
  /** 最终百分位（0–100，在本赛季批次内） */
  percentile: number;
}

/** 单名选手的完整 PRISM 结果 */
export interface PrismResult {
  steamId64: string;
  /** 使用的权重版本 */
  weightsVersion: string;
  /** 该选手参与的地图数（冷启动收缩依据） */
  mapCount: number;
  /** RR 百分位（0–100），用于整体颜色着色 */
  rrPercentile: number;
  axes: Record<PrismAxisKey, PrismAxisResult>;
}
