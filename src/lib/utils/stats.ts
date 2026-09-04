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
