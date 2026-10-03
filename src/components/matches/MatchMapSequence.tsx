import React from "react";
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
export function MatchMapSequence({ maps, currentMapId, entryAId, teamAName, teamBName, finished }: {
  maps: PublicSeriesMap[];
  currentMapId: string | null;
  entryAId: string;
  teamAName: string;
  teamBName: string;
  finished: boolean;
}) {
  return <section aria-label="BP 结果与地图" className="min-w-0 space-y-3">
    <h2 className="text-lg font-semibold">BP 结果与地图</h2>
    <ol className="grid gap-2 sm:grid-cols-3">{maps.map(map => {
      const completed = map.completedAt !== null && map.scoreA !== null && map.scoreB !== null;
      const current = !finished && map.id === currentMapId;
      return <li key={map.id} className={`min-w-0 border bg-[var(--color-panel-lo)] p-3 ${current ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-fg-dim)]"><span className="font-mono">MAP {map.mapOrder}</span><span>{completed ? "已结束" : finished ? "未进行" : current ? "当前地图" : "待进行"}</span></div>
        <div className="mt-2 flex items-center justify-between gap-3"><span className="font-semibold">{mapLabel(map.mapName)}</span><span className="font-mono font-bold tabular-nums">{completed ? `${map.scoreA} : ${map.scoreB}` : "—"}</span></div>
        <p className="mt-1 truncate text-xs text-[var(--color-fg-dim)]">{map.pickedByEntryId ? `${map.pickedByEntryId === entryAId ? teamAName : teamBName} 选图` : "决胜图"}</p>
      </li>;
    })}</ol>
  </section>;
}
