import React from "react";
import { Panel } from "@/components/rivalhub";
import { economyLabelCn } from "@/lib/demo/economy-series";
import type { EconomyTypeStats } from "@/lib/demo/economy-conversion";

interface EconomyConversionPanelProps {
  stats: Record<string, EconomyTypeStats>;
  teamName: string;
}

const ECONOMY_COLORS: Record<string, string> = {
  full: "text-[var(--color-success)]",
  semi: "text-[var(--color-fg-mid)]",
  eco: "text-[var(--color-error)]",
  force: "text-[var(--color-warn)]",
  pistol: "text-[var(--color-accent)]",
};

function WinRateBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  return (
    <div className="w-full bg-[var(--color-bg-subtle)] rounded-full h-2.5">
      <div
        className="bg-[var(--color-accent)] h-2.5 rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EconomyConversionPanel({
  stats,
  teamName,
}: EconomyConversionPanelProps) {
  const entries = Object.entries(stats).sort(
    ([, a], [, b]) => b.winRate - a.winRate,
  );

  if (entries.length === 0) {
    return (
      <Panel label={`${teamName} 经济转化率`}>
        <p className="text-sm text-[var(--color-fg-muted)] italic py-4 text-center">暂无经济数据</p>
      </Panel>
    );
  }

  return (
    <Panel label={`${teamName} 经济转化率`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="text-left py-2 px-3">经济类型</th>
              <th className="text-right py-2 px-3">回合数</th>
              <th className="text-right py-2 px-3">胜场</th>
              <th className="text-right py-2 px-3">胜率</th>
              <th className="py-2 px-3 w-1/3">胜率条</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([economy, s]) => (
              <tr
                key={economy}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)]"
              >
                <td className="py-2 px-3 font-medium">
                  <span className={ECONOMY_COLORS[economy] ?? "text-[var(--color-fg-mid)]"}>
                    {economyLabelCn(economy)}
                  </span>
                </td>
                <td className="py-2 px-3 text-right">{s.played}</td>
                <td className="py-2 px-3 text-right">{s.won}</td>
                <td className="py-2 px-3 text-right font-mono">
                  {(s.winRate * 100).toFixed(1)}%
                </td>
                <td className="py-2 px-3">
                  <WinRateBar rate={s.winRate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
