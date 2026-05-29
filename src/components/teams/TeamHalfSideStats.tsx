import React from "react";
import { Panel } from "@/components/rivalhub";
import type { HalfSideStats } from "@/lib/demo/halfside-winrate";

interface TeamHalfSideStatsProps {
  stats: Record<string, HalfSideStats>;
  teamName: string;
}

const SIDE_LABELS: Record<string, string> = {
  ct: "CT (防守方)",
  t: "T (进攻方)",
};

const SIDE_COLORS: Record<string, string> = {
  ct: "text-[var(--color-accent)]",
  t: "text-[var(--color-warn)]",
};

function WinRateBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  return (
    <div className="w-full bg-[var(--color-bg-subtle)] rounded-full h-3">
      <div
        className="bg-[var(--color-accent)] h-3 rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function TeamHalfSideStats({
  stats,
  teamName,
}: TeamHalfSideStatsProps) {
  const entries = Object.entries(stats);

  if (entries.length === 0) {
    return (
      <Panel label={`${teamName} T/CT 半场胜率`}>
        <p className="text-[var(--color-fg-muted)] text-sm text-center py-4">暂无数据</p>
      </Panel>
    );
  }

  return (
    <Panel label={`${teamName} T/CT 半场胜率`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {entries.map(([side, s]) => (
          <div
            key={side}
            className="bg-[var(--color-bg-subtle)] rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-lg font-semibold ${SIDE_COLORS[side] ?? "text-[var(--color-fg-mid)]"}`}>
                {SIDE_LABELS[side] ?? side}
              </span>
              <span className="text-xl font-bold font-mono">
                {(s.winRate * 100).toFixed(1)}%
              </span>
            </div>
            <WinRateBar rate={s.winRate} />
            <div className="flex justify-between text-xs text-[var(--color-fg-muted)] mt-2">
              <span>{s.won} 胜</span>
              <span>{s.played} 局</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
