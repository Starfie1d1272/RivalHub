import { STATS_METRICS, type StatsMetricKey } from "./metrics";

export interface StatsRateValue {
  rate: number | null;
  wins?: number;
  opportunities?: number;
  successes?: number;
  attempts?: number;
}

const economyLabels = { pistol: "手枪", eco: "经济局", semi: "半起", force: "强起", full: "全起" } as const;

const weaponLabels: Record<string, string> = {
  ak47: "AK-47", m4a1: "M4A4", m4a1_silencer: "M4A1-S", awp: "AWP", deagle: "Desert Eagle",
  glock: "Glock-18", usp_silencer: "USP-S", p250: "P250", fiveseven: "Five-SeveN", tec9: "Tec-9",
  mp9: "MP9", mac10: "MAC-10", ump45: "UMP-45", famas: "FAMAS", galilar: "Galil AR",
  hegrenade: "HE Grenade", flashbang: "Flashbang", inferno: "Incendiary", smokegrenade: "Smoke Grenade",
};

function formatSampleNumber(value: number): string {
  if (Number.isInteger(value)) return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

export function statsRateNumerator(value: StatsRateValue): number | undefined {
  return value.wins ?? value.successes;
}

export function statsRateDenominator(value: StatsRateValue): number | undefined {
  return value.opportunities ?? value.attempts;
}

export function formatStatsMetric(metric: StatsMetricKey, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const definition = STATS_METRICS[metric];
  if (definition.unit === "count") return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
  if (definition.unit === "percent") return `${value.toFixed(definition.precision)}%`;
  if (definition.unit === "seconds") return `${value.toFixed(definition.precision)}s`;
  return value.toFixed(definition.precision);
}

export function formatStatsRate(metric: StatsMetricKey, value: StatsRateValue): string {
  if (value.rate == null || !Number.isFinite(value.rate)) return "—";
  const definition = STATS_METRICS[metric];
  if (definition.unit === "percent") return `${(value.rate * 100).toFixed(definition.precision)}%`;
  if (definition.unit === "seconds") return `${value.rate.toFixed(definition.precision)}s`;
  return value.rate.toFixed(definition.precision);
}

export function formatStatsSample(value: StatsRateValue): string {
  const numerator = statsRateNumerator(value);
  const denominator = statsRateDenominator(value);
  return numerator === undefined || denominator === undefined ? "" : `${formatSampleNumber(numerator)}/${formatSampleNumber(denominator)}`;
}

export function formatStatsDenominator(value: StatsRateValue): string {
  const denominator = statsRateDenominator(value);
  return denominator === undefined ? "" : formatSampleNumber(denominator);
}

export function formatEconomyLabel(economy: keyof typeof economyLabels): string {
  return economyLabels[economy];
}

export function displayWeaponName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^(weapon_|item_)/, "").replace(/[\s-]+/g, "_");
  return weaponLabels[normalized] ?? value.trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
