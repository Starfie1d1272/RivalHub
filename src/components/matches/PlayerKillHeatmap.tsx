"use client";

import React, { useState, useMemo } from "react";
import { DemoHeatmap } from "./DemoHeatmap";
import type { DemoPoint, RawDemoKillRow, DemoPlayerStatRow } from "@/actions/demo-detail";
import { cn } from "@/lib/utils/cn";

interface PlayerKillHeatmapProps {
  mapName: string;
  rawKills: RawDemoKillRow[];
  playerStats: DemoPlayerStatRow[];
  playerNameMap: Record<string, string>;
}

/**
 * PlayerKillHeatmap
 * 在 DemoHeatmap 基础上增加选手筛选器，可查看个人击杀热区。
 */
export function PlayerKillHeatmap({ mapName, rawKills, playerStats, playerNameMap }: PlayerKillHeatmapProps) {
  const [selectedSteamId, setSelectedSteamId] = useState<string>("__all__");

  const points = useMemo(() => {
    const filteredKills = selectedSteamId === "__all__"
      ? rawKills
      : rawKills.filter((k) => k.killerSteamId64 === selectedSteamId || k.victimSteamId64 === selectedSteamId);

    const killPoints: DemoPoint[] = filteredKills
      .filter((k) => k.killerPosition && (selectedSteamId === "__all__" || k.killerSteamId64 === selectedSteamId))
      .map((k) => ({
        x: (k.killerPosition as { x: number; y: number; z: number }).x,
        y: (k.killerPosition as { x: number; y: number; z: number }).y,
        roundNumber: k.roundNumber,
        side: k.killerSide,
      }));

    const deathPoints: DemoPoint[] = filteredKills
      .filter((k) => k.victimPosition && (selectedSteamId === "__all__" || k.victimSteamId64 === selectedSteamId))
      .map((k) => ({
        x: (k.victimPosition as { x: number; y: number; z: number }).x,
        y: (k.victimPosition as { x: number; y: number; z: number }).y,
        roundNumber: k.roundNumber,
        side: k.victimSide,
      }));

    return {
      kills: killPoints,
      deaths: deathPoints,
      bombs: [] as DemoPoint[],
      grenades: [] as DemoPoint[],
    };
  }, [rawKills, selectedSteamId]);

  // 选手列表去重
  const playerOptions = useMemo(() => {
    const seen = new Set<string>();
    return playerStats.filter((p) => {
      if (seen.has(p.steamId64)) return false;
      seen.add(p.steamId64);
      return true;
    });
  }, [playerStats]);

  return (
    <div className="space-y-3">
      {/* 选手筛选 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--color-fg-dim)]">筛选选手:</span>
        <select
          value={selectedSteamId}
          onChange={(e) => setSelectedSteamId(e.target.value)}
          className="text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)]"
        >
          <option value="__all__">所有选手</option>
          {playerOptions.map((p) => (
            <option key={p.steamId64} value={p.steamId64}>
              {playerNameMap[p.steamId64] ?? p.steamId64.slice(0, 8)}
            </option>
          ))}
        </select>
        {selectedSteamId !== "__all__" && (
          <button
            type="button"
            onClick={() => setSelectedSteamId("__all__")}
            className="text-xs text-[var(--color-accent)] hover:underline"
          >
            清除筛选
          </button>
        )}
      </div>

      <DemoHeatmap mapName={mapName} points={points} />
    </div>
  );
}
