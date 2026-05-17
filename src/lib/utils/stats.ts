type HasMaps = { maps: number;[key: string]: unknown };

/**
 * 计算加权平均（按 maps 即图数加权）。
 * 用于 Rating/ADR/RWS/WE 等场均指标——因为不同赛季图数不同，简单平均会失真。
 */
export function wAvg(items: HasMaps[], field: string, precision = 1): string {
  const totalMaps = items.reduce((s, x) => s + x.maps, 0);
  if (totalMaps === 0) return "—";
  return (items.reduce((s, x) => s + (x[field] as number) * x.maps, 0) / totalMaps).toFixed(precision);
}

/**
 * 计算简单平均（按图数均分）。
 * 用于场均击杀/首杀/多杀/残局等计数型指标——每个赛季的 total 已预聚合，直接按赛季图数平均即可。
 */
export function sAvg(items: HasMaps[], field: string, precision = 1): string {
  const totalMaps = items.reduce((s, x) => s + x.maps, 0);
  if (totalMaps === 0) return "—";
  return (items.reduce((s, x) => s + (x[field] as number), 0) / totalMaps).toFixed(precision);
}

/** 对数组合并取和，全 null 返回 null */
export function sumNums(vals: (number | null)[]): number | null {
  const nums = vals.filter((v) => v != null) as number[];
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) : null;
}

/** 对数组值取平均，全 null 返回 null */
export function avgNums(vals: (number | null)[]): number | null {
  const nums = vals.filter((v) => v != null) as number[];
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** 按权重（如击杀数）对值做加权平均 */
export function weightedAvgNums(vals: (number | null)[], weights: (number | null)[]): number | null {
  let totalWeight = 0;
  let weightedSum = 0;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    const w = weights[i];
    if (v != null && w != null && w > 0) {
      weightedSum += v * w;
      totalWeight += w;
    }
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}
