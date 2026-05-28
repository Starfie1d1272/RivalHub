import type { StatFieldKey } from "@/types/season";

type MetricRow = Partial<Record<StatFieldKey, number | null>> & { perfectName: string };

/** 按指标降序,null 视为 -Infinity(排末尾)。返回新数组,不改原数组。 */
export function sortByMetric<T extends MetricRow>(rows: T[], metric: StatFieldKey): T[] {
  return [...rows].sort((a, b) => (num(b[metric]) - num(a[metric])));
}

/**
 * 系统推荐 MVP:借鉴 Astra 的 ADR 排名 + K/D 排名复合打分。
 * 不依赖任何平台特有 rating,适用于缺 rating 的赛季。
 */
export function computeRecommendedMvp<T extends MetricRow>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const byAdr = rankMap(rows, (r) => num(r.adr));
  const byKd = rankMap(rows, (r) => kd(r));
  let best: T | null = null;
  let bestScore = Infinity; // 名次和越小越好
  for (const r of rows) {
    const score = (byAdr.get(r) ?? 0) + (byKd.get(r) ?? 0);
    if (score < bestScore) { bestScore = score; best = r; }
  }
  return best;
}

function num(v: number | null | undefined): number {
  return typeof v === "number" ? v : Number.NEGATIVE_INFINITY;
}
function kd(r: MetricRow): number {
  const k = typeof r.kills === "number" ? r.kills : 0;
  const d = typeof r.deaths === "number" && r.deaths > 0 ? r.deaths : 1;
  return k / d;
}
/** 返回每行 → 名次(1 = 最高),数值相同名次相同。 */
function rankMap<T>(rows: T[], val: (r: T) => number): Map<T, number> {
  const sorted = [...rows].sort((a, b) => val(b) - val(a));
  const m = new Map<T, number>();
  sorted.forEach((r, i) => m.set(r, i + 1));
  return m;
}
