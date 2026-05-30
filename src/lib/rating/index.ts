/**
 * 评分系统统一入口
 *
 * 所有实现从 @rivalhub/rival-rating 包导入。
 * 权重更新流程：改 rival-rating 仓库 weights JSON → 打 tag → pnpm update → Vercel 部署。
 */

// ── 默认权重（直接 import JSON，避免上游 ESM `with { type: "json" }` 语法兼容问题）──
export { default as rrWeightsV1 } from "@rivalhub/rival-rating/weights/rr-v1.json";
export { default as prismWeightsV1 } from "@rivalhub/rival-rating/weights/prism-v1.json";

export {
  // ── RR 标量 ────────────────────────────────────────────────────────────
  computeRR,
  computeLeagueMean,
  // ── PRISM 画像 ─────────────────────────────────────────────────────────
  computePrism,
  rrToPercentile,
  zScoreAll,
  coldStartShrink,
  zToPercentile,
} from "@rivalhub/rival-rating";

export type {
  RRIndicators,
  RRWeights,
  PrismWeights,
  PrismComputeInput,
} from "@rivalhub/rival-rating";
