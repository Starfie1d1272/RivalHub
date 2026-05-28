/**
 * 选手 utility 数据输入，每个条目代表某位选手的单场 utility 统计。 */
export interface PlayerUtilityStatRow {
  steamId64: string;
  kills: number;
  deaths: number;
  assists: number;
  damageHealth: number;
  damageArmor: number;
  adr: number;
  utilityDamage: number;
  averageUtilityDamagePerRound: number;
  headshotCount: number;
  firstKillCount: number;
  firstDeathCount: number;
  tradeKillCount: number;
  tradeDeathCount: number;
  kast: number;
  oneKillCount: number;
  twoKillCount: number;
  threeKillCount: number;
  fourKillCount: number;
  fiveKillCount: number;
  vsOneCount: number;
  vsOneWonCount: number;
  vsTwoCount: number;
  vsTwoWonCount: number;
  vsThreeCount: number;
  vsThreeWonCount: number;
  vsFourCount: number;
  vsFourWonCount: number;
  vsFiveCount: number;
  vsFiveWonCount: number;
  bombPlantedCount: number;
  bombDefusedCount: number;
  wallbangKillCount: number;
  noScopeKillCount: number;
  collateralKillCount: number;
}

/**
 * Utility 聚合结果：combines utility damage from player stats +
 * flashAssist / throughSmoke counts from kill rows. */
export interface UtilityStat {
  steamId64: string;
  utilityDamage: number;
  avgUtilityDamagePerRound: number;
  flashAssistCount: number;
  throughSmokeCount: number;
}

interface KillRow {
  killerSteamId64: string;
  flashAssist?: boolean;
  throughSmoke?: boolean;
  weapon?: string;
}

/**
 * 按选手汇总 utility damage + flashAssist + throughSmoke。
 *
 * @param kills   demo_kill 行（需要 killerSteamId64, flashAssist, throughSmoke）
 * @param playerStats 选手统计行（需要 steamId64, utilityDamage, averageUtilityDamagePerRound）
 * @returns 按 utilityDamage 降序排列的 UtilityStat[]
 */
export function aggregateUtilityStats(
  kills: KillRow[],
  playerStats: PlayerUtilityStatRow[],
): UtilityStat[] {
  const map = new Map<string, UtilityStat>();

  // 从 playerStats 中提取 utilityDamage + avgUtilityDamagePerRound
  for (const s of playerStats) {
    map.set(s.steamId64, {
      steamId64: s.steamId64,
      utilityDamage: s.utilityDamage,
      avgUtilityDamagePerRound: s.averageUtilityDamagePerRound,
      flashAssistCount: 0,
      throughSmokeCount: 0,
    });
  }

  // 从 kills 中统计 flashAssist / throughSmoke
  for (const k of kills) {
    const sid = k.killerSteamId64;
    if (!map.has(sid)) {
      map.set(sid, {
        steamId64: sid,
        utilityDamage: 0,
        avgUtilityDamagePerRound: 0,
        flashAssistCount: 0,
        throughSmokeCount: 0,
      });
    }
    const entry = map.get(sid)!;
    if (k.flashAssist) entry.flashAssistCount += 1;
    if (k.throughSmoke) entry.throughSmokeCount += 1;
  }

  return Array.from(map.values()).sort((a, b) => b.utilityDamage - a.utilityDamage);
}
