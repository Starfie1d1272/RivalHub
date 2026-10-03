"use client";

import React, { useEffect, useRef, useState } from "react";
import { MatchLiveProvider, useMatchLive } from "./MatchLiveProvider";
import type { PublicMatchContext } from "@/lib/matches/public-context";
import { liveFreshness, visibleLiveSnapshot } from "@/lib/mizar/live-viewer-state";
import { publicRoundScore } from "@/lib/mizar/live-presentation";
import { mapLabel } from "@/lib/maps";

interface Props { matchId: string; entryAId: string; entryBId: string; context: PublicMatchContext }
export function MatchListLiveScore(props: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={ref} className="block min-w-20 text-center" data-testid="match-list-live-score">
    <MatchLiveProvider matchId={props.matchId} enabled={visible && props.context.phase === "gameplay"}><MatchListScoreSurface {...props} /></MatchLiveProvider>
  </span>;
}
export function MatchListScoreSurface({ entryAId, entryBId, context }: Omit<Props, "matchId">) {
  const { state, now } = useMatchLive();
  const snapshot = visibleLiveSnapshot(state, now, context.phase, context.currentMapId);
  const score = snapshot ? publicRoundScore(snapshot, entryAId, entryBId) : null;
  const stale = liveFreshness(state, now) === "stale";
  const phaseLabel = context.phase === "veto" ? "BP 进行中" : context.phase === "inter_map" ? "图间休息" : context.phase === "awaiting_gameplay" ? "等待对局" : context.phase === "gameplay" ? "实时数据暂不可用" : "等待 BP";
  return <>
    {score && snapshot ? <>
      <span className="block text-lg font-bold tabular-nums text-[var(--color-fg)]" aria-label="本图回合比分">{score.scoreA ?? "—"} : {score.scoreB ?? "—"}</span>
      <span className={`block text-xs ${stale ? "text-[var(--color-fg-dim)]" : "text-[var(--color-ok)]"}`}>{mapLabel(snapshot.map.name ?? "")} · {stale ? "更新暂时中断" : "实时"}</span>
    </> : <span className="block text-xs text-[var(--color-fg-mid)]">{phaseLabel}</span>}
    {(snapshot || context.seriesProgress) && <span className="block text-xs text-[var(--color-fg-dim)]">地图胜场 {snapshot?.series.scoreA ?? context.seriesProgress?.scoreA ?? "—"} : {snapshot?.series.scoreB ?? context.seriesProgress?.scoreB ?? "—"}</span>}
  </>;
}
