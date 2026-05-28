import type { DemoPlayerStatRow, KillFeedItem } from "@/actions/demo-detail";

export interface UtilityStat {
  steamId64: string;
  utilityDamage: number;
  avgUtilityDamagePerRound: number;
  flashAssistCount: number;
  throughSmokeCount: number;
}

/**
 * 聚合选手 utility 统计信息。
 * - playerStats 提供 utilityDamage、avgUtilityDamagePerRound
 * - kills 用于统计 flashAssist 和 throughSmoke
 * 结果按 utilityDamage 降序排列。
 */
export function aggregateUtilityStats(
  kills: Pick<KillFeedItem, "killerSteamId64" | "flashAssist" | "throughSmoke">[],
  playerStats: DemoPlayerStatRow[],
): UtilityStat[] {
  const map = new Map<string, UtilityStat>();

  // 从 playerStats 中提取 utilityDamage + avgUtilityDamagePerRound
  for (const s of playerStats) {
    if (!s.steamId64) continue;
    map.set(s.steamId64, {
      steamId64: s.steamId64,
      utilityDamage: s.utilityDamage ?? 0,
      avgUtilityDamagePerRound: s.averageUtilityDamagePerRound ?? 0,
      flashAssistCount: 0,
      throughSmokeCount: 0,
    });
  }

  // 从 kills 中统计 flashAssist / throughSmoke
  for (const k of kills) {
    const sid = k.killerSteamId64;
    if (!sid) continue;
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

  return [...map.values()].sort((a, b) => b.utilityDamage - a.utilityDamage);
}
