import React from "react";
import { cn } from "@/lib/utils/cn";
import type { ClutchRow } from "@/actions/demo-detail";

interface DemoClutchListProps {
  clutches: ClutchRow[];
  /** steamId64 → 游戏内昵称 */
  playerNameMap: Record<string, string>;
}

/**
 * Clutch replay list.
 * Displays "R{round} player 1vN W/L ·K kills" with win/loss coloring.
 */
export function DemoClutchList({ clutches, playerNameMap }: DemoClutchListProps) {
  if (clutches.length === 0) {
    return <p className="text-xs text-[var(--color-fg-dim)] py-2">No clutch data</p>;
  }

  const sorted = [...clutches].sort((a, b) => a.roundNumber - b.roundNumber);

  return (
    <div className="space-y-1">
      {sorted.map((c, i) => {
        const playerName = playerNameMap[c.clutcherSteamId64 ?? ""] ?? c.clutcherSteamId64 ?? "Unknown";
        const clutchType = c.opponentCount != null ? `1v${c.opponentCount}` : "1v?";
        const result = c.won ? "W" : "L";
        const killInfo = c.killCount != null ? ` ·${c.killCount}K` : "";

        return (
          <div
            key={`${c.roundNumber}-${c.clutcherSteamId64}-${i}`}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded text-xs",
              "border border-[var(--color-border)]",
              c.won
                ? "bg-green-900/10 border-green-700/20"
                : "bg-red-900/10 border-red-700/20",
            )}
          >
            <span className="font-mono text-[var(--color-fg-dim)] tabular-nums">
              R{c.roundNumber}
            </span>
            <span className="font-medium text-[var(--color-fg)] truncate max-w-[100px]">
              {playerName}
            </span>
            <span className="font-mono text-[var(--color-fg-mid)]">{clutchType}</span>
            <span className={cn("font-bold", c.won ? "text-green-400" : "text-red-400")}>
              {result}
            </span>
            {killInfo && (
              <span className="text-[var(--color-fg-dim)]">{killInfo}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
