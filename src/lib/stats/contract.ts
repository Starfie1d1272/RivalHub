/**
 * 玩家统计的数值与展示 contract。
 *
 * 聚合层只返回 number | null；unit/precision 只由 format.ts 消费，避免
 * 页面和组件各自重新解释同一指标。
 */
import type { StatsDisplayUnit } from "./display";

export const STAT_METRICS = {
  kills:      { precision: 0, unit: "count" },
  deaths:     { precision: 0, unit: "count" },
  assists:    { precision: 0, unit: "count" },
  firstKills: { precision: 0, unit: "count" },
  multiKills: { precision: 0, unit: "count" },
  clutches:   { precision: 0, unit: "count" },
  ratingPro:  { precision: 2, unit: "number" },
  adr:        { precision: 1, unit: "number" },
  rws:        { precision: 2, unit: "number" },
  we:         { precision: 1, unit: "number" },
  hsPercent:  { precision: 0, unit: "percentPoints" },
  kd:         { precision: 2, unit: "number" },
  kpr:        { precision: 2, unit: "number" },
  fkpr:       { precision: 2, unit: "per100Round" },
  mkpr:       { precision: 2, unit: "per100Round" },
  cpr:        { precision: 2, unit: "per100Round" },
} satisfies Record<string, { precision: number; unit: StatsDisplayUnit }>;

export type StatMetric = keyof typeof STAT_METRICS;
