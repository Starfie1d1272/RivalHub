"use client";

import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { TeamLogoImage } from "@/components/teams/TeamLogoImage";

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

function HalfScore({
  label,
  segment,
  teamAName,
  teamBName,
}: {
  label: string;
  segment: RoundSegment;
  teamAName: string;
  teamBName: string;
}) {
  const sideB = segment.sideA === "ct" ? "t" : "ct";
  const description = `${label}半场：${teamAName}（${segment.sideA.toUpperCase()}）${segment.scoreA} : ${teamBName}（${sideB.toUpperCase()}）${segment.scoreB}`;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" title={description}>
      <span className="sr-only">{description}</span>
      <span aria-hidden="true" className="font-mono">
        <span
          className={
            segment.sideA === "ct" ? "text-[var(--color-info)]" : "text-[var(--color-warn)]"
          }
        >
          {segment.scoreA}
        </span>
        <span className="text-[var(--color-fg-dim)]">:</span>
        <span className={sideB === "ct" ? "text-[var(--color-info)]" : "text-[var(--color-warn)]"}>
          {segment.scoreB}
        </span>
      </span>
    </span>
  );
}

export function MatchMapSequence({
  maps,
  currentMapId,
  seasonSlug,
  entryAId,
  teamAName,
  teamBName,
  teamALogoUrl = null,
  teamBLogoUrl = null,
  finished,
  entryBId,
  phase = "awaiting_gameplay",
  seriesProgress,
}: {
  maps: PublicSeriesMap[];
  seasonSlug?: string;
  currentMapId: string | null;
  entryAId: string;
  entryBId?: string;
  phase?: MatchPresentationPhase;
  seriesProgress?: { scoreA: number; scoreB: number } | null;
  teamAName: string;
  teamBName: string;
  teamALogoUrl?: string | null;
  teamBLogoUrl?: string | null;
  finished: boolean;
}) {
  const { state, now } = useMatchLive();
  const snapshot = visibleLiveSnapshot(state, now, phase, currentMapId);
  const liveScore = snapshot && entryBId ? publicRoundScore(snapshot, entryAId, entryBId) : null;
  const progress = snapshot?.series ?? seriesProgress;
  const stale = liveFreshness(state, now) === "stale";
  return (
    <section aria-label="BP 结果与地图" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">BP 结果与地图</h2>
        <div className="flex items-baseline gap-3 text-xs text-[var(--color-fg-mid)]">
          {maps.some(
            (map) =>
              map.segments &&
              map.completedAt !== null &&
              map.scoreA !== null &&
              map.scoreB !== null,
          ) && (
            <span className="font-mono">
              <span className="text-[var(--color-info)]">CT</span> /{" "}
              <span className="text-[var(--color-warn)]">T</span>
            </span>
          )}
          {progress && (
            <p aria-label="地图胜场">
              Series {progress.scoreA ?? "—"} : {progress.scoreB ?? "—"}{" "}
              <HelpTooltip
                label="地图胜场说明"
                content="Series 表示双方已赢下的地图数；每张地图上的数字表示该图回合比分。"
              />
            </p>
          )}
        </div>
      </div>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
        {maps.map((map) => {
          const played = map.completedAt !== null;
          const completed = played && map.scoreA !== null && map.scoreB !== null;
          const current = !finished && map.id === currentMapId;
          const thumbnail = mapThumbnail(map.mapName);
          const scoreA = completed ? map.scoreA : current && liveScore ? liveScore.scoreA : null;
          const scoreB = completed ? map.scoreB : current && liveScore ? liveScore.scoreB : null;
          const winner =
            completed && scoreA !== null && scoreB !== null && scoreA !== scoreB
              ? scoreA > scoreB
                ? "a"
                : "b"
              : null;
          const resultA =
            winner === "a"
              ? "text-[var(--color-ok)]"
              : winner === "b"
                ? "text-[var(--color-danger)]"
                : "text-[var(--color-fg)]";
          const resultB =
            winner === "b"
              ? "text-[var(--color-ok)]"
              : winner === "a"
                ? "text-[var(--color-danger)]"
                : "text-[var(--color-fg)]";
          const status = played
            ? "已结束"
            : finished
              ? "未进行"
              : current
                ? snapshot
                  ? stale
                    ? "更新暂时中断"
                    : "进行中"
                  : phase === "inter_map"
                    ? "下一张地图"
                    : "当前地图"
                : "待进行";
          const pickClassName =
            "rounded-sm bg-[var(--color-info-soft)] px-1 py-0.5 font-mono text-[10px] font-bold leading-none text-[var(--color-info)]";
          return (
            <li
              key={map.id}
              className={`min-w-0 overflow-hidden border bg-[var(--color-panel-low)] ${current ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"} ${!played && !current ? "opacity-50" : ""}`}
            >
              <div
                style={{
                  backgroundImage: thumbnail
                    ? `linear-gradient(0deg, color-mix(in srgb, var(--color-bg) 65%, transparent), color-mix(in srgb, var(--color-bg) 25%, transparent)), url("${thumbnail}")`
                    : undefined,
                }}
                className="relative flex h-16 items-center justify-center bg-[var(--color-panel-hi)] bg-cover bg-center px-3"
              >
                <span className="absolute left-2 top-1 bg-[var(--color-scrim)] px-1 py-0.5 font-mono text-[10px] leading-none text-[var(--color-fg-mid)]">
                  MAP {map.mapOrder}
                </span>
                <h3 className="text-xl font-bold text-[var(--color-fg)]">
                  {mapLabel(map.mapName)}
                </h3>
                <span
                  className={
                    completed
                      ? "sr-only"
                      : "absolute right-2 top-1 bg-[var(--color-scrim)] px-1 py-0.5 text-[10px] leading-none text-[var(--color-fg-mid)]"
                  }
                >
                  {status}
                </span>
                {completed && !map.pickedByEntryId && (
                  <span className="absolute right-2 top-1 bg-[var(--color-scrim)] px-1 py-0.5 font-mono text-[10px] leading-none text-[var(--color-fg-mid)]">
                    DECIDER
                  </span>
                )}
              </div>
              <div className="px-3 py-2">
                <div className="grid grid-cols-2 items-center gap-4 text-sm">
                  <TeamProfileLink
                    seasonSlug={seasonSlug}
                    entryId={entryAId}
                    className="flex min-w-0 items-center gap-2 font-semibold"
                    title={teamAName}
                  >
                    <span className="relative size-7 shrink-0">
                      <TeamLogoImage
                        logoUrl={teamALogoUrl}
                        teamName={teamAName}
                        fill
                        sizes="28px"
                        imageClassName="object-contain"
                      />
                    </span>
                    <span className="truncate">{teamAName}</span>
                  </TeamProfileLink>
                  <TeamProfileLink
                    seasonSlug={seasonSlug}
                    entryId={entryBId}
                    className="flex min-w-0 items-center justify-end gap-2 text-right font-semibold"
                    title={teamBName}
                  >
                    <span className="truncate">{teamBName}</span>
                    <span className="relative size-7 shrink-0">
                      <TeamLogoImage
                        logoUrl={teamBLogoUrl}
                        teamName={teamBName}
                        fill
                        sizes="28px"
                        imageClassName="object-contain"
                      />
                    </span>
                  </TeamProfileLink>
                </div>
                <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
                  <div className="flex items-center gap-2">
                    <span className="flex w-7 shrink-0 justify-center">
                      {map.pickedByEntryId === entryAId && (
                        <span className={pickClassName} title={`${teamAName} 选图`}>
                          PICK
                        </span>
                      )}
                    </span>
                    <span
                      className={`font-mono text-xl font-bold tabular-nums ${resultA}`}
                      aria-label={`${teamAName} 本图回合 ${scoreA ?? "—"}`}
                    >
                      {scoreA ?? "—"}
                    </span>
                  </div>
                  <div
                    className="flex min-w-0 max-w-32 flex-wrap items-center justify-center gap-x-1 text-xs tabular-nums text-[var(--color-fg-mid)]"
                    aria-label={completed ? "分段比分" : undefined}
                  >
                    {completed ? (
                      map.segments ? (
                        <>
                          <span className="whitespace-nowrap">
                            (
                            <HalfScore
                              label="上"
                              segment={map.segments.firstHalf}
                              teamAName={teamAName}
                              teamBName={teamBName}
                            />
                            ;{" "}
                            <HalfScore
                              label="下"
                              segment={map.segments.secondHalf}
                              teamAName={teamAName}
                              teamBName={teamBName}
                            />
                            )
                          </span>
                          {map.segments.overtime && (
                            <span
                              className="whitespace-nowrap font-mono"
                              title={`加时：${teamAName} ${map.segments.overtime.scoreA} : ${teamBName} ${map.segments.overtime.scoreB}`}
                            >
                              <span className="sr-only">加时</span>({map.segments.overtime.scoreA}:
                              {map.segments.overtime.scoreB})
                            </span>
                          )}
                        </>
                      ) : (
                        <span>分段 —</span>
                      )
                    ) : !map.pickedByEntryId ? (
                      <span className="font-mono text-[10px]">DECIDER</span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <span
                      className={`font-mono text-xl font-bold tabular-nums ${resultB}`}
                      aria-label={`${teamBName} 本图回合 ${scoreB ?? "—"}`}
                    >
                      {scoreB ?? "—"}
                    </span>
                    <span className="flex w-7 shrink-0 justify-center">
                      {map.pickedByEntryId === entryBId && (
                        <span className={pickClassName} title={`${teamBName} 选图`}>
                          PICK
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                {map.pickedByEntryId &&
                  map.pickedByEntryId !== entryAId &&
                  map.pickedByEntryId !== entryBId && (
                    <p className="mt-1 text-center text-[10px] text-[var(--color-fg-mid)]">
                      <TeamProfileLink seasonSlug={seasonSlug} entryId={map.pickedByEntryId}>
                        队伍
                      </TeamProfileLink>{" "}
                      · PICK
                    </p>
                  )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
