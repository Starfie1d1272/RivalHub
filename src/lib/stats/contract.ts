/**
 * 玩家统计的数值与展示 contract。
 *
 * 聚合层只返回 number | null；unit/precision 只由 format.ts 消费，避免
 * 页面和组件各自重新解释同一指标。
 */
export const STAT_METRICS = {
  kills:      { precision: null, unit: "count" },
  deaths:     { precision: null, unit: "count" },
  assists:    { precision: null, unit: "count" },
  firstKills: { precision: null, unit: "count" },
  multiKills: { precision: null, unit: "count" },
  clutches:   { precision: null, unit: "count" },
  ratingPro:  { precision: 2, unit: "number" },
  adr:        { precision: 1, unit: "number" },
  rws:        { precision: 2, unit: "number" },
  we:         { precision: 1, unit: "number" },
  hsPercent:  { precision: 0, unit: "percent" },
  kd:         { precision: 2, unit: "number" },
  kpr:        { precision: 2, unit: "number" },
  fkpr:       { precision: 1, unit: "per100r" },
  mkpr:       { precision: 1, unit: "per100r" },
  cpr:        { precision: 1, unit: "per100r" },
} as const;

export type StatMetric = keyof typeof STAT_METRICS;
