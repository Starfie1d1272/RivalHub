"use client";

import { useState } from "react";
import { Panel } from "@/components/rivalhub";
import { mapLabel } from "@/lib/maps";
import type { MapProfileRow } from "@/lib/matches/pre-analysis";

type Rate = { count: number; sample: number };

export function MatchMapProfile({ rows, teamAName, teamBName }: { rows: MapProfileRow[]; teamAName: string; teamBName: string }) {
  const [metric, setMetric] = useState<"win" | "pick" | "ban">("win");
  const value = (rate: Rate) => rate.sample > 0 ? `${Math.round(rate.count / rate.sample * 100)}%` : "—";
  const sampleUnit = metric === "win" ? "图" : "场 BP";
  return <Panel label="地图画像" contentClassName="p-4">
    <div className="mb-4 flex gap-2" role="group" aria-label="地图指标">
      {([ ["win", "胜率"], ["pick", "选择率"], ["ban", "禁用率"] ] as const).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)} className={`rounded px-3 py-1.5 text-xs font-medium ${metric === key ? "bg-[var(--color-accent)] text-black" : "border border-[var(--color-border)]"}`}>{label}</button>
      )}
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)] gap-2 border-b border-[var(--color-border)] pb-2 text-xs text-[var(--color-fg-mid)]"><span className="truncate">{teamAName}</span><span className="text-center">地图</span><span className="truncate text-right">{teamBName}</span></div>
    {rows.map(row => <div key={row.mapName} className="grid grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)] items-center gap-2 border-b border-[var(--color-border)] py-2 last:border-0">
      <div className="text-right tabular-nums"><span className="text-sm font-semibold">{value(row.a[metric])}</span><span className="ml-2 text-xs text-[var(--color-fg-mid)]">{row.a[metric].sample} {sampleUnit}</span></div>
      <div className="truncate text-center text-xs font-medium">{mapLabel(row.mapName)}</div>
      <div className="text-left tabular-nums"><span className="text-sm font-semibold">{value(row.b[metric])}</span><span className="ml-2 text-xs text-[var(--color-fg-mid)]">{row.b[metric].sample} {sampleUnit}</span></div>
    </div>)}
  </Panel>;
}
