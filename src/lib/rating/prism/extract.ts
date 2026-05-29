/**
 * 从 RRIndicators 提取单根轴的原始分
 *
 * 按 SignalConfig[] 加权求和，处理 null 字段和 invert 标志。
 */

import type { RRIndicators } from "../types/indicators";
import type { SignalConfig } from "../types/prism";

/**
 * 对一组信号配置做加权求和，返回原始轴分。
 *
 * - null 字段按 0 处理（对应 weight 在 config 里设 0 即可无效化）
 * - invert=true 时用 (1 - value) 反转（适用于 dpr、firstDeathRate 等"低更好"信号）
 *   注意：invert 假设信号已归一化到 [0, 1]；若未归一化请在 indicators 里预处理
 */
export function extractAxisScore(
  ind: RRIndicators,
  signals: SignalConfig[],
): number {
  let score = 0;
  let totalWeight = 0;

  for (const cfg of signals) {
    const raw = ind[cfg.signal];
    // null / undefined → 跳过（不纳入加权分母，信号缺失时不拉低分数）
    if (raw === null || raw === undefined) continue;

    const value = typeof raw === "number" ? raw : 0;
    const adjusted = cfg.invert ? 1 - value : value;

    score += adjusted * cfg.weight;
    totalWeight += cfg.weight;
  }

  // 所有信号都是 null 时返回 0
  if (totalWeight === 0) return 0;

  // 归一化到实际可用权重之和（缺失信号不拉低整体）
  return score / totalWeight;
}
