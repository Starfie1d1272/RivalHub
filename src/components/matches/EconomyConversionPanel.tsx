"use client";

import React from "react";
import { Panel } from "@/components/rivalhub";
import type { EconomyTypeStats } from "@/lib/demo/economy-conversion";

interface EconomyConversionPanelProps {
  stats: Record<string, EconomyTypeStats>;
  teamName: string;
}

const ECONOMY_LABELS: Record<string, string> = {
  full: "全枪全弹",
  semi: "半起",
  eco: "纯ECO",
  force: "强起",
  pistol: "手枪局",
};

const ECONOMY_COLORS: Record<string, string> = {
  full: "text-green-600",
  semi: "text-yellow-600",
  eco: "text-red-600",
  force: "text-orange-600",
  pistol: "text-blue-600",
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

  return (
    <Panel label={`${teamName} 经济转化率`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
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
                className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <td className="py-2 px-3 font-medium">
                  <span className={ECONOMY_COLORS[economy] ?? "text-gray-600"}>
                    {ECONOMY_LABELS[economy] ?? economy}
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
