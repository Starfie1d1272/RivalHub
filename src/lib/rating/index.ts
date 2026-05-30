/**
 * 评分系统统一入口
 *
 * 当前使用本地文件。待 @rivalhub/rival-rating 仓库完善后切换：
 *   1. rival-rating 移除 .js 导入后缀（适配 webpack/Next.js bundler 模式）
 *   2. 或 rival-rating 提供预编译 dist
 *   3. 改下方 import 为 from "@rivalhub/rival-rating"
 *
 * 权重更新流程：修改 weights/*.json → Admin 后台重算评分
 */

// ── RR 标量 ──────────────────────────────────────────────────────────────
export {
  computeRR,
  computeLeagueMean,
} from "./rr/compute";

// ── PRISM 画像 ───────────────────────────────────────────────────────────
export {
  computePrism,
  rrToPercentile,
} from "./prism/compute";
export {
  zScoreAll,
  coldStartShrink,
  zToPercentile,
} from "./prism/zscore";

// ── 类型 ─────────────────────────────────────────────────────────────────
export type {
  RRIndicators,
} from "./types/indicators";
export type {
  RRWeights,
  RRResult,
} from "./types/rr";
export type {
  PrismWeights,
  PrismAxisKey,
  PrismAxisResult,
  PrismResult,
} from "./types/prism";
export type {
  PrismComputeInput,
} from "./prism/compute";

// ── 默认权重 ─────────────────────────────────────────────────────────────
export { default as rrWeightsV1 } from "./weights/rr-v1.json";
export { default as prismWeightsV1 } from "./weights/prism-v1.json";
