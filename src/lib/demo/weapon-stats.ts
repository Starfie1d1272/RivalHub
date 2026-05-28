/** 单次击杀/武器使用原始数据行 */
export interface WeaponKillRow {
  weapon: string;
  headshot: boolean;
  roundNumber: number;
  steamId64: string;
}

/** 聚合后的武器统计 */
export interface WeaponStat {
  weapon: string;
  kills: number;
  headshots: number;
  headshotRate: number;
  rounds: number;
}

/**
 * 聚合选手在各武器上的击杀统计。
 * 纯函数，输入为某选手在 demoKills 表中的相关行。
 * 输出按 kills 降序排列。
 */
export function aggregateWeaponStats(rows: WeaponKillRow[]): WeaponStat[] {
  if (rows.length === 0) return [];

  const weaponMap = new Map<
    string,
    { kills: number; headshots: number; rounds: Set<number> }
  >();

  for (const row of rows) {
    let entry = weaponMap.get(row.weapon);
    if (!entry) {
      entry = { kills: 0, headshots: 0, rounds: new Set() };
      weaponMap.set(row.weapon, entry);
    }
    entry.kills += 1;
    if (row.headshot) entry.headshots += 1;
    entry.rounds.add(row.roundNumber);
  }

  const stats: WeaponStat[] = [];
  for (const [weapon, data] of weaponMap) {
    stats.push({
      weapon,
      kills: data.kills,
      headshots: data.headshots,
      headshotRate: data.kills > 0 ? data.headshots / data.kills : 0,
      rounds: data.rounds.size,
    });
  }

  stats.sort((a, b) => b.kills - a.kills);
  return stats;
}
