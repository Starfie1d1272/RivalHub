export type StatsDisplayUnit =
  | "count"
  | "number"
  | "percentPoints"
  | "ratioPercent"
  | "perRound"
  | "per100Round"
  | "seconds";

export interface StatsDisplayRule {
  unit: StatsDisplayUnit;
  precision: number;
}

/**
 * Shared stats display formatter.
 * Aggregation keeps canonical values; presentation owns scale, precision and suffix.
 */
export function formatDisplayValue(
  value: number | null | undefined,
  rule: StatsDisplayRule,
): string {
  if (value == null || !Number.isFinite(value)) return "—";

  if (rule.unit === "count") {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
  }

  const scale =
    rule.unit === "ratioPercent" || rule.unit === "per100Round"
      ? 100
      : 1;
  const suffix =
    rule.unit === "percentPoints" || rule.unit === "ratioPercent"
      ? "%"
      : rule.unit === "seconds"
        ? "s"
        : "";

  return `${(value * scale).toFixed(rule.precision)}${suffix}`;
}
