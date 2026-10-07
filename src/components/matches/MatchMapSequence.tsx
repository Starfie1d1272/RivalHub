"use client";

import { TeamProfileLink } from "@/components/teams/TeamProfileLink";

import React from "react";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { useMatchLive } from "./MatchLiveProvider";
import { liveFreshness, visibleLiveSnapshot } from "@/lib/mizar/live-viewer-state";
import { publicRoundScore } from "@/lib/mizar/live-presentation";
import type { MatchPresentationPhase } from "@/lib/matches/presentation-phase";
import { mapThumbnail } from "@/lib/map-thumbnail";
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
export function MatchMapSequence({ maps, currentMapId, seasonSlug, entryAId, teamAName, teamBName, finished, entryBId, phase = "awaiting_gameplay", seriesProgress }: {
  maps: PublicSeriesMap[];
  seasonSlug?: string;
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
      {progress && <p className="text-sm text-[var(--color-fg-mid)]" aria-label="地图胜场">Series {progress.scoreA ?? "—"} : {progress.scoreB ?? "—"} <HelpTooltip label="地图胜场说明" content="Series 表示双方已赢下的地图数；每张地图上的数字表示该图回合比分。" /></p>}</div>
    <ol className="grid gap-3 sm:grid-cols-3">{maps.map(map => {
      const completed = map.completedAt !== null && map.scoreA !== null && map.scoreB !== null;
      const current = !finished && map.id === currentMapId;
      return <li key={map.id} style={{ backgroundImage: mapThumbnail(map.mapName) ? `linear-gradient(90deg, color-mix(in srgb, var(--color-bg) 88%, transparent), color-mix(in srgb, var(--color-bg) 55%, transparent)), url("${mapThumbnail(map.mapName)}")` : undefined }} className={`min-w-0 border bg-[var(--color-panel-low)] bg-cover bg-center p-4 ${current ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-fg-mid)]"><span className="font-mono">MAP {map.mapOrder}</span><span>{completed ? "已结束" : finished ? "未进行" : current ? snapshot ? stale ? "更新暂时中断" : "进行中" : phase === "inter_map" ? "下一张地图" : "当前地图" : "待进行"}</span></div>
        <div className="mt-2 flex items-center justify-between gap-3"><span className="font-semibold text-[var(--color-fg)]">{mapLabel(map.mapName)}</span><span className="font-mono font-bold tabular-nums text-[var(--color-fg)]">{completed ? `${map.scoreA} : ${map.scoreB}` : current && liveScore ? `${liveScore.scoreA ?? "—"} : ${liveScore.scoreB ?? "—"}` : "—"}</span></div>
        {current && liveScore && <p className="sr-only">本图回合</p>}
        <p className="mt-1 truncate text-xs text-[var(--color-fg-mid)]">{map.pickedByEntryId ? <><TeamProfileLink seasonSlug={seasonSlug} entryId={map.pickedByEntryId}>{map.pickedByEntryId === entryAId ? teamAName : map.pickedByEntryId === entryBId ? teamBName : "队伍"}</TeamProfileLink> · PICK</> : "DECIDER"}</p>
      </li>;
    })}</ol>
  </section>;
}
