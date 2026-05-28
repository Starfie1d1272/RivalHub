"use client";

import React, { useState, useMemo } from "react";
import { Panel } from "@/components/rivalhub";
import { cn } from "@/lib/utils/cn";
import type { ClutchRow, DemoPlayerStatRow } from "@/actions/demo-detail";

interface PlayerClutchStatsProps {
  clutches: ClutchRow[];
  playerStats: DemoPlayerStatRow[];
  playerNameMap: Record<string, string>;
}

interface PlayerClutchSummary {
  steamId64: string;
  playerName: string;
  total: number;
  won: number;
  byOpponents: Record<number, { total: number; won: number }>;
}

function buildClutchSummaries(
  clutches: ClutchRow[],
  playerNameMap: Record<string, string>
): PlayerClutchSummary[] {
  const playerMap = new Map<string, PlayerClutchSummary>();

  for (const c of clutches) {
    if (!c.clutcherSteamId64) continue;
    let summary = playerMap.get(c.clutcherSteamId64);
    if (!summary) {
      summary = {
        steamId64: c.clutcherSteamId64,
        playerName: playerNameMap[c.clutcherSteamId64] ?? c.clutcherSteamId64,
        total: 0,
        won: 0,
        byOpponents: {},
      };
      playerMap.set(c.clutcherSteamId64, summary);
    }
    summary.total++;
    if (c.won) summary.won++;

    const opp = c.opponentCount ?? 1;
    if (!summary.byOpponents[opp]) {
      summary.byOpponents[opp] = { total: 0, won: 0 };
    }
    summary.byOpponents[opp].total++;
    if (c.won) summary.byOpponents[opp].won++;
  }

  return Array.from(playerMap.values()).sort(
    (a, b) => b.total - a.total
  );
}

export function PlayerClutchStats({
  clutches,
  playerStats,
  playerNameMap,
}: PlayerClutchStatsProps) {
  const [selectedSteamId, setSelectedSteamId] = useState<string>("__all__");

  const summaries = useMemo(
    () => buildClutchSummaries(clutches, playerNameMap),
    [clutches, playerNameMap]
  );

  const filteredSummaries = useMemo(
    () =>
      selectedSteamId === "__all__"
        ? summaries
        : summaries.filter((s) => s.steamId64 === selectedSteamId),
    [summaries, selectedSteamId]
  );

  const maxOpponents = useMemo(
    () =>
      Math.max(
        ...summaries.flatMap((s) => Object.keys(s.byOpponents).map(Number)),
        1
      ),
    [summaries]
  );

  return (
    <Panel label="选手残局能力">
      <div className="space-y-3">
        <select
          value={selectedSteamId}
          onChange={(e) => setSelectedSteamId(e.target.value)}
          className={cn(
            "w-full text-sm p-2 rounded",
            "bg-[var(--color-bg-subtle)] text-[var(--color-fg)]",
            "border border-[var(--color-border)]"
          )}
        >
          <option value="__all__">所有选手</option>
          {summaries.map((s) => (
            <option key={s.steamId64} value={s.steamId64}>
              {s.playerName} — {s.won}/{s.total} 胜
            </option>
          ))}
        </select>
      </div>

      {filteredSummaries.length === 0 && (
        <p className="text-sm text-[var(--color-fg-mid)] text-center py-4">
          无残局数据
        </p>
      )}

      {filteredSummaries.map((summary) => (
        <div
          key={summary.steamId64}
          className="mt-4 border border-[var(--color-border)] rounded p-3"
        >
          <div className="text-sm font-semibold mb-2">
            {summary.playerName}
            <span className="text-[var(--color-fg-mid)] font-normal ml-2">
              残局 {summary.won}/{summary.total} (
              {summary.total > 0
                ? Math.round((summary.won / summary.total) * 100)
                : 0}
              %)
            </span>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(maxOpponents, 4)}, 1fr)` }}>
            {Array.from({ length: maxOpponents }, (_, i) => {
              const opp = i + 1;
              const data = summary.byOpponents[opp];
              if (!data) return null;
              const winRate =
                data.total > 0
                  ? Math.round((data.won / data.total) * 100)
                  : 0;
              return (
                <div
                  key={opp}
                  className={cn(
                    "text-center p-2 rounded",
                    "bg-[var(--color-bg-subtle)]",
                    data.won > 0 && data.won === data.total && "bg-green-900/30",
                    data.won === 0 && data.total > 0 && "bg-red-900/30"
                  )}
                >
                  <div className="text-sm font-semibold">v{opp}</div>
                  <div className="text-xs text-[var(--color-fg-mid)]">
                    {data.won}/{data.total}
                  </div>
                  <div className="text-xs">{winRate}%</div>
                </div>
              );
            })}
          </div>

          {/* 所有残局明细 */}
          <details className="mt-2">
            <summary className="text-xs text-[var(--color-fg-mid)] cursor-pointer">
              查看明细 ({clutches.filter(c => c.clutcherSteamId64 === summary.steamId64).length} 局)
            </summary>
            <div className="mt-2 max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--color-fg-mid)] border-b border-[var(--color-border)]">
                    <th className="text-left py-1 px-1">Rd</th>
                    <th className="text-left py-1 px-1">对手</th>
                    <th className="text-left py-1 px-1">击杀</th>
                    <th className="text-left py-1 px-1">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {clutches
                    .filter((c) => c.clutcherSteamId64 === summary.steamId64)
                    .slice(0, 50)
                    .map((c, i) => (
                      <tr
                        key={i}
                        className={cn(
                          "border-b border-[var(--color-border-subtle)]",
                          c.won ? "text-green-400" : "text-red-400"
                        )}
                      >
                        <td className="py-1 px-1">{c.roundNumber}</td>
                        <td className="py-1 px-1">v{c.opponentCount ?? "?"}</td>
                        <td className="py-1 px-1">{c.killCount ?? 0}</td>
                        <td className="py-1 px-1">{c.won ? "W" : "L"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ))}
    </Panel>
  );
}
