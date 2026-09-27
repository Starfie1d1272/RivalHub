import { STAT_METRICS, type StatMetric } from "./contract";
import { formatDisplayValue } from "./display";

export type { StatMetric } from "./contract";

/** 通用 number|null 格式化；尺度、精度和后缀最终都由 display.ts 处理。 */
export function formatNumber(value: number | null | undefined, precision: number): string {
  return formatDisplayValue(value, { unit: "number", precision });
}

/**
 * 统计展示 formatter：null/undefined/非有限值统一为 “—”，真实 0 保留。
 * 指标尺度与精度由 STAT_METRICS 定义，实际格式化统一委托给 display.ts。
 */
export function formatStat(metric: StatMetric, value: number | null | undefined): string {
  return formatDisplayValue(value, STAT_METRICS[metric]);
}
