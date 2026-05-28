"use client";

import React from "react";
import { Panel } from "@/components/rivalhub";
import { cn } from "@/lib/utils/cn";
import { aggregateUtilityStats, type UtilityStat } from "@/lib/demo/utility-stats";
import type { DemoPlayerStatRow, KillFeedItem } from "@/actions/demo-detail";

interface PlayerUtilityStatsProps {
  kills: Pick<KillFeedItem, "killerSteamId64" | "flashAssist" | "throughSmoke">[];
  playerStats: DemoPlayerStatRow[];
  playerNameMap: Record<string, string>;
}

export function PlayerUtilityStats({
  kills,
  playerStats,
  playerNameMap,
}: PlayerUtilityStatsProps) {
  const stats = React.useMemo(
    () => aggregateUtilityStats(kills, playerStats),
    [kills, playerStats],
  );

  if (!stats.length) {
    return null;
  }

  return (
    <Panel title="🔧 道具统计">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-gray-400">
              <th className="py-1 pr-2">选手</th>
              <th className="py-1 px-2 text-right">道具伤害</th>
              <th className="py-1 px-2 text-right">均伤/局</th>
              <th className="py-1 px-2 text-right">闪白助攻</th>
              <th className="py-1 px-2 text-right">穿烟</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr
                key={s.steamId64}
                className="border-b border-gray-800 hover:bg-gray-800/50"
              >
                <td className="py-1 pr-2 font-medium">
                  {playerNameMap[s.steamId64] ?? s.steamId64.slice(0, 8)}
                </td>
                <td className="py-1 px-2 text-right">{s.utilityDamage}</td>
                <td className="py-1 px-2 text-right">
                  {s.avgUtilityDamagePerRound.toFixed(1)}
                </td>
                <td className="py-1 px-2 text-right">{s.flashAssistCount}</td>
                <td className="py-1 px-2 text-right">{s.throughSmokeCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-xs text-gray-500">
        道具伤害含手雷/燃烧弹/ incendiary 等。闪白助攻指被闪后击杀。
      </div>
    </Panel>
  );
}
