import { formatDisplayValue } from "./display";
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
  hkp2000: "P2000", elite: "Dual Berettas", revolver: "R8 Revolver", cz75a: "CZ75-Auto", ssg08: "SSG 08", aug: "AUG", sg556: "SG 553", mp7: "MP7",
  taser: "Zeus x27", p90: "P90", negev: "Negev", scar20: "SCAR-20", g3sg1: "G3SG1", nova: "Nova", xm1014: "XM1014", mag7: "MAG-7", sawedoff: "Sawed-Off", mp5sd: "MP5-SD", m249: "M249", bizon: "PP-Bizon",
  knife: "匕首", knife_t: "匕首", bayonet: "刺刀", knife_css: "海豹短刀", knife_flip: "折叠刀", knife_gut: "穿肠刀", knife_karambit: "爪子刀", knife_m9_bayonet: "M9 刺刀", knife_tactical: "猎杀者匕首", knife_falchion: "弯刀", knife_survival_bowie: "鲍伊猎刀", knife_butterfly: "蝴蝶刀", knife_push: "暗影双匕", knife_cord: "系绳匕首", knife_canis: "求生匕首", knife_ursus: "熊刀", knife_gypsy_jackknife: "折刀", knife_outdoor: "流浪者匕首", knife_stiletto: "短剑", knife_widowmaker: "锯齿爪刀", knife_skeleton: "骷髅匕首", knife_kukri: "廓尔喀刀", c4: "C4", planted_c4: "C4", world: "环境", worldspawn: "环境", trigger_hurt: "环境", molotov: "燃烧瓶", incgrenade: "燃烧弹",
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
  return formatDisplayValue(value, STATS_METRICS[metric]);
}

function canonicalRate(value: StatsRateValue): number | null {
  const numerator = statsRateNumerator(value);
  const denominator = statsRateDenominator(value);
  if (
    numerator !== undefined &&
    Number.isFinite(numerator) &&
    denominator !== undefined &&
    Number.isFinite(denominator) &&
    denominator > 0
  ) {
    return numerator / denominator;
  }
  return value.rate != null && Number.isFinite(value.rate) ? value.rate : null;
}

export function formatStatsRate(metric: StatsMetricKey, value: StatsRateValue): string {
  return formatDisplayValue(canonicalRate(value), STATS_METRICS[metric]);
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
