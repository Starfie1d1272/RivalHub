import { STAT_METRICS, type StatMetric } from "./contract";
import { formatDisplayValue } from "./display";

export type { StatMetric } from "./contract";

/**
 * 统计展示 formatter：null/undefined/非有限值统一为 “—”，真实 0 保留。
 * 指标尺度与精度由 STAT_METRICS 定义，实际格式化统一委托给 display.ts。
 */
export function formatStat(metric: StatMetric, value: number | null | undefined): string {
  return formatDisplayValue(value, STAT_METRICS[metric]);
}
