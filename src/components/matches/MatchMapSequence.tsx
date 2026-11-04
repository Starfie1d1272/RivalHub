"use client";

import { TeamProfileLink } from "@/components/teams/TeamProfileLink";

import React from "react";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { useMatchLive } from "./MatchLiveProvider";
import { liveFreshness, visibleLiveSnapshot } from "@/lib/mizar/live-viewer-state";
import { publicRoundScore } from "@/lib/mizar/live-presentation";
import type { RoundSegment, RoundSegments } from "@/lib/matches/round-segments";
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
  segments?: RoundSegments;
}

function HalfScore({ label, segment, teamAName, teamBName }: { label: string; segment: RoundSegment; teamAName: string; teamBName: string }) {
  const sideB = segment.sideA === "ct" ? "t" : "ct";
  const description = `${label}半场：${teamAName}（${segment.sideA.toUpperCase()}）${segment.scoreA} : ${teamBName}（${sideB.toUpperCase()}）${segment.scoreB}`;
  return <span className="inline-flex items-baseline gap-1 whitespace-nowrap" title={description}>
    <span className="sr-only">{description}</span>
    <span aria-hidden="true">{label}</span>
    <span aria-hidden="true" className="font-mono"><span className={segment.sideA === "ct" ? "text-[var(--color-info)]" : "text-[var(--color-warn)]"}>{segment.scoreA}</span><span className="text-[var(--color-fg-dim)]">:</span><span className={sideB === "ct" ? "text-[var(--color-info)]" : "text-[var(--color-warn)]"}>{segment.scoreB}</span></span>
  </span>;
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
      <div className="flex items-baseline gap-3 text-xs text-[var(--color-fg-mid)]">
        {maps.some(map => map.segments && map.completedAt !== null && map.scoreA !== null && map.scoreB !== null) && <span className="font-mono"><span className="text-[var(--color-info)]">CT</span> / <span className="text-[var(--color-warn)]">T</span></span>}
        {progress && <p aria-label="地图胜场">Series {progress.scoreA ?? "—"} : {progress.scoreB ?? "—"} <HelpTooltip label="地图胜场说明" content="Series 表示双方已赢下的地图数；每张地图上的数字表示该图回合比分。" /></p>}
      </div></div>
    <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3">{maps.map(map => {
      const played = map.completedAt !== null;
      const completed = played && map.scoreA !== null && map.scoreB !== null;
      const current = !finished && map.id === currentMapId;
      const thumbnail = mapThumbnail(map.mapName);
      return <li key={map.id} style={{ backgroundImage: thumbnail ? `linear-gradient(90deg, color-mix(in srgb, var(--color-bg) 88%, transparent), color-mix(in srgb, var(--color-bg) 55%, transparent)), url("${thumbnail}")` : undefined }} className={`min-w-0 border bg-[var(--color-panel-low)] bg-cover bg-center p-3 ${current ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>
        <div className="flex items-baseline justify-between gap-2 text-xs text-[var(--color-fg-mid)]"><span className="min-w-0 truncate"><span className="mr-2 font-mono text-[var(--color-fg-dim)]">MAP {map.mapOrder}</span><span className="text-sm font-semibold text-[var(--color-fg)]">{mapLabel(map.mapName)}</span></span><span className="shrink-0">{played ? "已结束" : finished ? "未进行" : current ? snapshot ? stale ? "更新暂时中断" : "进行中" : phase === "inter_map" ? "下一张地图" : "当前地图" : "待进行"}</span></div>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
          <TeamProfileLink seasonSlug={seasonSlug} entryId={entryAId} className="truncate" title={teamAName}>{teamAName}</TeamProfileLink>
          <span className="font-mono font-bold tabular-nums text-[var(--color-fg)]">{completed ? `${map.scoreA} : ${map.scoreB}` : current && liveScore ? `${liveScore.scoreA ?? "—"} : ${liveScore.scoreB ?? "—"}` : "—"}</span>
          <TeamProfileLink seasonSlug={seasonSlug} entryId={entryBId} className="truncate text-right" title={teamBName}>{teamBName}</TeamProfileLink>
        </div>
        {current && liveScore && <p className="sr-only">本图回合</p>}
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-[var(--color-fg-mid)]">
          <p className="min-w-0 truncate">{map.pickedByEntryId ? <><TeamProfileLink seasonSlug={seasonSlug} entryId={map.pickedByEntryId}>{map.pickedByEntryId === entryAId ? teamAName : map.pickedByEntryId === entryBId ? teamBName : "队伍"}</TeamProfileLink> · PICK</> : "DECIDER"}</p>
          {completed && <div className="flex flex-wrap gap-x-2 gap-y-1 tabular-nums" aria-label="分段比分">
            {map.segments ? <>
              <HalfScore label="上" segment={map.segments.firstHalf} teamAName={teamAName} teamBName={teamBName} />
              <HalfScore label="下" segment={map.segments.secondHalf} teamAName={teamAName} teamBName={teamBName} />
              {map.segments.overtime && <span className="whitespace-nowrap" title={`加时：${teamAName} ${map.segments.overtime.scoreA} : ${teamBName} ${map.segments.overtime.scoreB}`}>OT <span className="font-mono">{map.segments.overtime.scoreA}:{map.segments.overtime.scoreB}</span></span>}
            </> : <span>分段 —</span>}
          </div>}
        </div>
      </li>;
    })}</ol>
  </section>;
}
