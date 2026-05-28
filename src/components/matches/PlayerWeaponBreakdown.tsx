"use client";

import React, { useState, useMemo } from "react";
import { Panel } from "@/components/rivalhub";
import { cn } from "@/lib/utils/cn";
import { aggregateWeaponStats, type WeaponStat } from "@/lib/demo/weapon-stats";
import type { RawDemoKillRow, DemoPlayerStatRow } from "@/actions/demo-detail";

interface PlayerWeaponBreakdownProps {
  rawKills: RawDemoKillRow[];
  playerStats: DemoPlayerStatRow[];
  playerNameMap: Record<string, string>;
}

export function PlayerWeaponBreakdown({
  rawKills,
  playerStats,
  playerNameMap,
}: PlayerWeaponBreakdownProps) {
  const players = useMemo(
    () =>
      playerStats.map((s) => ({
        steamId64: s.steamId64,
        name: playerNameMap[s.steamId64] ?? s.steamId64.slice(0, 8),
      })),
    [playerStats, playerNameMap],
  );

  const [selectedSteamId, setSelectedSteamId] = useState<string>("__all__");

  const weaponStats = useMemo((): WeaponStat[] | null => {
    if (selectedSteamId === "__all__") return null;

    const killerRows = rawKills
      .filter((k) => k.killerSteamId64 === selectedSteamId && k.weapon != null)
      .map((k) => ({
        weapon: k.weapon!,
        headshot: k.headshot === true,
        roundNumber: k.roundNumber,
        steamId64: k.killerSteamId64!,
      }));

    return aggregateWeaponStats(killerRows);
  }, [rawKills, selectedSteamId]);

  return (
    <Panel label="Weapon Breakdown">
      <div className="flex items-center gap-2 mb-3">
        <select
          value={selectedSteamId}
          onChange={(e) => setSelectedSteamId(e.target.value)}
          className={cn(
            "text-sm px-2 py-1 rounded",
            "bg-[var(--color-bg)] text-[var(--color-fg)]",
            "border border-[var(--color-border)]",
          )}
        >
          <option value="__all__">选择选手查看武器偏好</option>
          {players.map((p) => (
            <option key={p.steamId64} value={p.steamId64}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {!weaponStats ? (
        <p className="text-xs text-[var(--color-fg-mid)]">选择选手后查看武器偏好统计</p>
      ) : weaponStats.length === 0 ? (
        <p className="text-xs text-[var(--color-fg-mid)]">该选手没有武器击杀数据</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-mid)]">
                <th className="text-left py-1 pr-3">武器</th>
                <th className="text-right py-1 px-2">击杀</th>
                <th className="text-right py-1 px-2">爆头</th>
                <th className="text-right py-1 px-2">爆头率</th>
                <th className="text-right py-1 pl-2">涉及回合</th>
              </tr>
            </thead>
            <tbody>
              {weaponStats.map((stat) => (
                <tr
                  key={stat.weapon}
                  className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-bg-mid)]/30"
                >
                  <td className="py-1 pr-3 font-medium">{stat.weapon}</td>
                  <td className="text-right py-1 px-2">{stat.kills}</td>
                  <td className="text-right py-1 px-2">{stat.headshots}</td>
                  <td className="text-right py-1 px-2">
                    {(stat.headshotRate * 100).toFixed(0)}%
                  </td>
                  <td className="text-right py-1 pl-2">{stat.rounds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
