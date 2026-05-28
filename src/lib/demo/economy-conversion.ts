/**
 * 回合经济数据输入，每个条目代表某队在某回合的经济类型和是否获胜。
 */
export interface EconomyConversionEntry {
  teamKey: string;
  economy: string;
  won: boolean;
}

/**
 * 按经济类型分组的统计结果。
 */
export interface EconomyTypeStats {
  played: number;
  won: number;
  winRate: number;
}

/**
 * 经济转化率：按经济类型统计某队回合胜率。
 * 
 * 输入是从 demo_rounds 展开的「队伍-回合-经济类型-是否赢」条目。
 * 经济类型字符串不硬编码，按实际值分组。
 * 
 * @param rounds 某队的所有回合经济条目
 * @returns 按经济类型分组的 { played, won, winRate }
 */
export function economyConversion(
  rounds: EconomyConversionEntry[],
): Record<string, EconomyTypeStats> {
  const groups = new Map<string, { played: number; won: number }>();

  for (const r of rounds) {
    const g = groups.get(r.economy) ?? { played: 0, won: 0 };
    g.played += 1;
    if (r.won) g.won += 1;
    groups.set(r.economy, g);
  }

  const result: Record<string, EconomyTypeStats> = {};
  for (const [economy, stats] of groups) {
    result[economy] = {
      played: stats.played,
      won: stats.won,
      winRate: stats.played > 0 ? stats.won / stats.played : 0,
    };
  }

  return result;
}
