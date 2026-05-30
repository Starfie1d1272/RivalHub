/**
 * 评分系统统一入口 — 适配 @rivalhub/rival-rating 外部仓库
 *
 * 权重更新流程：
 *   1. 修改 rival-rating 仓库中的 rr-v1.json / prism-v1.json
 *   2. 升 version 字段（如 rr-1.0 → rr-1.1）
 *   3. RivalHub 侧 `pnpm install` 拿到最新依赖
 *   4. Admin 后台重算评分
 *
 * 开发模式（link:）下，修改 rival-rating 源文件后直接生效，
 * 无需重新 install（Next.js 自动热编译）。
 */

// ── RR 标量 ──────────────────────────────────────────────────────────────
export {
  computeRR,
  computeLeagueMean,
} from "@rivalhub/rival-rating";

// ── PRISM 画像 ───────────────────────────────────────────────────────────
export {
  computePrism,
  rrToPercentile,
  zScoreAll,
  coldStartShrink,
  zToPercentile,
} from "@rivalhub/rival-rating";

// ── 类型 ─────────────────────────────────────────────────────────────────
export type {
  RRIndicators,
  RRWeights,
  RRResult,
  PrismWeights,
  PrismAxisKey,
  PrismAxisResult,
  PrismResult,
  PrismComputeInput,
} from "@rivalhub/rival-rating";

// ── 默认权重 ─────────────────────────────────────────────────────────────
// 当 rival-rating 仓库完善 export 后改为：
//   import { rrWeightsV1, prismWeightsV1 } from "@rivalhub/rival-rating";
// 当前通过文件路径直接引用（两个仓库权重文件完全一致）：
export { default as rrWeightsV1 } from "./weights/rr-v1.json";
export { default as prismWeightsV1 } from "./weights/prism-v1.json";
