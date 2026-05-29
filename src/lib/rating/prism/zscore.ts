/**
 * z-score 工具函数
 *
 * 所有函数均为纯函数，无副作用。
 */

/**
 * 对一组数值做 z-score 标准化。
 * 样本标准差（分母 n-1）；样本量 <= 1 时全返回 0。
 */
export function zScoreAll(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 0);

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / std);
}

/**
 * 冷启动收缩：样本少时向均值（z=0）收缩。
 *
 * z_shown = z_raw · n / (n + k)
 *
 * @param z    原始 z-score
 * @param n    该选手参与的地图数
 * @param k    收缩常数（config coldStartK，约等于"几张图后稳定"）
 */
export function coldStartShrink(z: number, n: number, k: number): number {
  if (k <= 0) return z;
  return z * (n / (n + k));
}

/**
 * 经验百分位：target 在 sortedValues 中的百分位（0–100）。
 *
 * 使用线性插值，边界处理：
 *   - 低于最小值 → 0
 *   - 高于最大值 → 100
 */
export function empiricalPercentile(
  sortedValues: number[],
  target: number,
): number {
  if (sortedValues.length === 0) return 50;
  if (sortedValues.length === 1) return 50;

  let pos = 0;
  for (let i = 0; i < sortedValues.length; i++) {
    if ((sortedValues[i] ?? 0) <= target) pos = i + 1;
    else break;
  }

  return (pos / sortedValues.length) * 100;
}

/**
 * 标准正态分布 CDF（近似）——用于小批次时的平滑百分位估算。
 * 精度约 ±0.0001。
 *
 * @returns 0–1
 */
export function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422820 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z >= 0 ? 1 - p : p;
}

/**
 * 将 z-score 转为 0–100 百分位，优先用经验排名，
 * 样本 < minEmpiricalN 时退化到正态 CDF。
 */
export function zToPercentile(
  z: number,
  cohortZScores: number[],
  minEmpiricalN = 5,
): number {
  if (cohortZScores.length >= minEmpiricalN) {
    const sorted = [...cohortZScores].sort((a, b) => a - b);
    return empiricalPercentile(sorted, z);
  }
  return normalCDF(z) * 100;
}
