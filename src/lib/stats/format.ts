import { STAT_METRICS, type StatMetric } from "./contract";

export type { StatMetric } from "./contract";

/** 统一处理 number|null，所有 toFixed 都应收口在这里。 */
export function formatNumber(value: number | null | undefined, precision: number): string {
  return value != null && Number.isFinite(value) ? value.toFixed(precision) : "—";
}

/**
 * 统计展示 formatter：null/undefined/非有限值统一为 “—”，真实 0 保留。
 * FKPR/MKPR/CPR 的底层值仍是 per-round，这里只做 /100r 展示换算。
 */
export function formatStat(metric: StatMetric, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";

  const definition = STAT_METRICS[metric];
  if (definition.unit === "count") return String(value);
  if (definition.unit === "per100r") return (value * 100).toFixed(definition.precision);
  if (definition.unit === "percent") return `${value.toFixed(definition.precision)}%`;
  return value.toFixed(definition.precision);
}
