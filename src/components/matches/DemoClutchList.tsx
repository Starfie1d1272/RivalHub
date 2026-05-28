import React from "react";
import { cn } from "@/lib/utils/cn";
import type { ClutchRow } from "@/actions/demo-detail";

interface DemoClutchListProps {
  clutches: ClutchRow[];
}

/**
 * 残局复盘列表。
 * 展示「R{round} 选手名 1vN 胜/负 ·击杀 K」,胜负配色。
 */
export function DemoClutchList({ clutches }: DemoClutchListProps) {
  if (clutches.length === 0) {
    return <p className="text-xs text-[var(--color-fg-dim)] py-2">暂无残局数据</p>;
  }

  // 按 roundNumber 排序
  const sorted = [...clutches].sort((a, b) => a.roundNumber - b.roundNumber);

  return (
    <div className="space-y-1">
      {sorted.map((c, i) => {
        const playerName = c.clutcherSteamId64 ?? "未知选手";
        const clutchType = c.opponentCount != null ? `1v${c.opponentCount}` : "1v?";
        const result = c.won ? "胜" : "负";
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
            {/* 回合号 */}
            <span className="font-mono text-[var(--color-fg-dim)] tabular-nums">
              R{c.roundNumber}
            </span>

            {/* 选手名 */}
            <span className="font-medium text-[var(--color-fg)] truncate max-w-[100px]">
              {playerName}
            </span>

            {/* 残局类型 */}
            <span className="font-mono text-[var(--color-fg-mid)]">{clutchType}</span>

            {/* 胜负 */}
            <span
              className={cn(
                "font-bold",
                c.won ? "text-green-400" : "text-red-400",
              )}
            >
              {result}
            </span>

            {/* 击杀数 */}
            {killInfo && (
              <span className="text-[var(--color-fg-dim)]">{killInfo}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
