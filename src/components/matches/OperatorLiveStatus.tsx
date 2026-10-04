"use client";

import React from "react";
import { MatchLiveProvider, useMatchLive } from "./MatchLiveProvider";
import { liveFreshness } from "@/lib/mizar/live-viewer-state";

type Scope = { authorityRevision: number; generation: number; epoch: number; mapId: string | null };

/** Receive-only feedback. Neither this timer nor missing frames authorize a mutation. */
export function OperatorLiveStatus({ matchId, scope }: { matchId: string; scope: Scope }) {
  return <MatchLiveProvider key={`${scope.authorityRevision}:${scope.generation}:${scope.epoch}:${scope.mapId}`} matchId={matchId}>
    <OperatorLiveStatusText scope={scope} />
  </MatchLiveProvider>;
}

export function OperatorLiveStatusText({ scope }: { scope: Scope }) {
  const { state, now } = useMatchLive();
  const snapshot = state.snapshot;
  const current = snapshot && scope.mapId !== null && snapshot.map.mapId === scope.mapId
    && snapshot.delivery.authorityRevision === scope.authorityRevision
    && snapshot.delivery.generation === scope.generation && snapshot.delivery.epoch === scope.epoch;
  const freshness = current ? liveFreshness(state, now) : "unavailable";
  return <p role="status">{freshness === "fresh" ? "正在接收本图数据" : current ? "比赛数据暂未更新" : "尚未收到本图实时数据"}</p>;
}
