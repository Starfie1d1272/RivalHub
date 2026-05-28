/**
 * 半场回合数据输入，每个条目代表某队某回合的 side 和是否获胜。
 */
export interface HalfSideEntry {
  teamSide: string;
  won: boolean;
}

/**
 * 按 side 分组的统计结果。
 */
export interface HalfSideStats {
  played: number;
  won: number;
  winRate: number;
}

/**
 * T/CT 半场强弱：按 side（t/ct）统计某队胜率。
 *
 * 输入是从 demo_rounds 推导的「队伍-回合-side-是否赢」条目。
 * side 字符串不硬编码，按实际值分组。
 *
 * @param rounds 某队所有回合的 side 与胜负
 * @returns 按 side 分组的 { played, won, winRate }
 */
export function halfSideWinRate(
  rounds: HalfSideEntry[],
): Record<string, HalfSideStats> {
  const groups = new Map<string, { played: number; won: number }>();

  for (const r of rounds) {
    const g = groups.get(r.teamSide) ?? { played: 0, won: 0 };
    g.played += 1;
    if (r.won) g.won += 1;
    groups.set(r.teamSide, g);
  }

  const result: Record<string, HalfSideStats> = {};
  for (const [side, stats] of groups) {
    result[side] = {
      played: stats.played,
      won: stats.won,
      winRate: stats.played > 0 ? stats.won / stats.played : 0,
    };
  }

  return result;
}
