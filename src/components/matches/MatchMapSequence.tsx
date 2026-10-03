"use client";

import React from "react";
import { useMatchLive } from "./MatchLiveProvider";
import { liveFreshness, visibleLiveSnapshot } from "@/lib/mizar/live-viewer-state";
import { publicRoundScore } from "@/lib/mizar/live-presentation";
import type { MatchPresentationPhase } from "@/lib/matches/presentation-phase";
import { mapLabel } from "@/lib/maps";

export interface PublicSeriesMap {
  id: string;
  mapOrder: number;
  mapName: string;
  pickedByEntryId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  completedAt: string | null;
}
export function MatchMapSequence({ maps, currentMapId, entryAId, teamAName, teamBName, finished, entryBId, phase = "awaiting_gameplay", seriesProgress }: {
  maps: PublicSeriesMap[];
  currentMapId: string | null;
  entryAId: string;
  entryBId?: string;
  phase?: MatchPresentationPhase;
  seriesProgress?: { scoreA: number; scoreB: number } | null;
  teamAName: string;
  teamBName: string;
  finished: boolean;
}) {
  const { state, now } = useMatchLive();
  const snapshot = visibleLiveSnapshot(state, now, phase, currentMapId);
  const liveScore = snapshot && entryBId ? publicRoundScore(snapshot, entryAId, entryBId) : null;
  const progress = snapshot?.series ?? seriesProgress;
  const stale = liveFreshness(state, now) === "stale";
  return <section aria-label="BP 结果与地图" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">BP 结果与地图</h2>
      {progress && <p className="text-sm text-[var(--color-fg-mid)]" aria-label="地图胜场">地图胜场 {progress.scoreA ?? "—"} : {progress.scoreB ?? "—"}</p>}</div>
    <ol className="grid gap-2 sm:grid-cols-3">{maps.map(map => {
      const completed = map.completedAt !== null && map.scoreA !== null && map.scoreB !== null;
      const current = !finished && map.id === currentMapId;
      return <li key={map.id} className={`min-w-0 border bg-[var(--color-panel-low)] p-3 ${current ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-fg-dim)]"><span className="font-mono">MAP {map.mapOrder}</span><span>{completed ? "已结束" : finished ? "未进行" : current ? snapshot ? stale ? "更新暂时中断" : "实时" : phase === "inter_map" ? "下一张地图" : "当前地图" : "待进行"}</span></div>
        <div className="mt-2 flex items-center justify-between gap-3"><span className="font-semibold">{mapLabel(map.mapName)}</span><span className="font-mono font-bold tabular-nums">{completed ? `${map.scoreA} : ${map.scoreB}` : current && liveScore ? `${liveScore.scoreA ?? "—"} : ${liveScore.scoreB ?? "—"}` : "—"}</span></div>
        {current && liveScore && <p className="mt-1 text-xs text-[var(--color-fg-dim)]">本图回合</p>}
        <p className="mt-1 truncate text-xs text-[var(--color-fg-dim)]">{map.pickedByEntryId ? `${map.pickedByEntryId === entryAId ? teamAName : teamBName} 选图` : "决胜图"}</p>
      </li>;
    })}</ol>
  </section>;
}
