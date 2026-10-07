import type { normalizeStagePlan } from "@/lib/seasons/compatibility";

/**
 * 根据阶段配置、轮次与所在 bracket 分组决定比赛格式。
 * finalFormat（BO5 覆写）只作用于"真正的决赛"，绝不溢出到其他场次：
 *   - 双败淘汰（double_elim）：仅总决赛（grand final，groupNumber === 3）。
 *     胜者组决赛 / 败者组决赛的轮号虽可能等于 log2(bracketSize)，但不是决赛。
 *   - 单败淘汰（single_elim）：最后一轮（roundNumber === log2(bracketSize)）。
 *   - 其他赛制（循环/瑞士/GSL）没有单场决赛，不会触发覆写。
 */
export function resolveMatchFormat(
  stagePlan: ReturnType<typeof normalizeStagePlan>,
  stageKey: string,
  roundNumber: number,
  groupNumber?: number,
): "bo1" | "bo3" | "bo5" {
  const sc = stagePlan.find((s) => s.key === stageKey);
  if (!sc) return "bo3";

  const isFinal =
    sc.type === "double_elim"
      ? groupNumber === 3 // grand final 分组
      : sc.type === "single_elim" && isLastBracketRound(roundNumber, sc.teamCount);

  if (isFinal && sc.finalFormat) return sc.finalFormat;
  return sc.matchFormat ?? "bo3";
}

/**
 * 是否为单败淘汰的最后一轮（决赛）。
 * 使用 2^n 对齐的实际 bracket 大小，而非配置的参赛队数，
 * 确保非 2 的幂队数（如 6 队含 bye）时也能正确判定。
 */
function isLastBracketRound(roundNumber: number, teamCount: number): boolean {
  let bracketSize = 1;
  while (bracketSize < teamCount) bracketSize <<= 1;
  return roundNumber === Math.log2(bracketSize);
}
