"use client";

import { useState } from "react";
import type { TournamentTeamDetail } from "@/lib/stats/tournament-query";
import { mapLabel } from "@/lib/maps";
import { mapThumbnail } from "@/lib/map-thumbnail";

export function TeamMapProfile({ maps, samples }: { maps: Pick<TournamentTeamDetail["maps"][number], "mapName" | "results" | "selection">[]; samples: TournamentTeamDetail["vetoActionSamples"] }) {
  const [metric, setMetric] = useState<"win" | "pick" | "ban">("win");
  const rows = maps.toSorted((a, b) => (b.results?.played ?? 0) - (a.results?.played ?? 0));
  return <section className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">本届地图画像</h2>
      <div className="flex gap-1" role="group" aria-label="地图指标">
        {([["win", "胜率"], ["pick", "Pick"], ["ban", "Ban"]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)} className={`min-h-9 rounded-sm px-3 text-sm ${metric === key ? "bg-[var(--color-accent)] text-black" : "border border-[var(--color-border)]"}`}>{label}</button>)}
      </div>
    </div>
    <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {rows.map(row => {
        const count = metric === "win" ? row.results?.wins ?? 0 : metric === "pick" ? row.selection?.picks ?? 0 : row.selection?.bans ?? 0;
        const sample = metric === "win" ? row.results?.played ?? 0 : samples[metric];
        const rate = sample > 0 ? Math.round(count / sample * 100) : null;
        const thumbnail = mapThumbnail(row.mapName);
        return <div key={row.mapName} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div className="flex h-12 items-center rounded-sm bg-[var(--color-panel)] bg-cover bg-center px-2 text-sm font-semibold" style={thumbnail ? { backgroundImage: `linear-gradient(90deg, #090c10dd, #090c1055), url("${thumbnail}")` } : undefined}>{mapLabel(row.mapName)}</div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-[var(--color-fg-mid)]"><span className="text-sm font-semibold tabular-nums text-[var(--color-fg)]">{rate === null ? "—" : `${rate}%`}</span><span>{metric === "win" ? `${count} 胜 ${row.results?.losses ?? 0} 负 · ${sample} 图` : `${count} 次 / ${sample} 场 BP`}</span></div>
            <div className="h-1.5 overflow-hidden bg-[var(--color-border)]" aria-hidden="true"><div className="h-full bg-[var(--color-accent)]" style={{ width: `${Math.min(100, rate ?? 0)}%` }} /></div>
          </div>
        </div>;
      })}
      {rows.length === 0 && <p className="py-6 text-sm text-[var(--color-fg-mid)]">暂无正式地图或 BP 记录。</p>}
    </div>
  </section>;
}
