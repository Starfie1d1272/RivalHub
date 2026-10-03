"use client";

import React from "react";
import { useMatchLive } from "./MatchLiveProvider";
import Link from "next/link";
import { MatchRadar } from "./MatchRadar";
import { visibleLiveSnapshot, liveFreshness, liveClockSeconds, type LiveViewerState } from "@/lib/mizar/live-viewer-state";
import { presentBomb, presentLivePhase, formatLiveClock } from "@/lib/mizar/live-presentation";
import { mapLabel } from "@/lib/maps";
import type { PublicLiveMatchProjection } from "@/lib/mizar/live-projection";

type LivePhase = Extract<import("@/lib/matches/presentation-phase").MatchPresentationPhase, "awaiting_gameplay" | "gameplay" | "inter_map">;
export interface MatchRealtimeProps {
  matchId: string;
  phase: LivePhase;
  currentMapId: string | null;
}

export function MatchRealtime(props: MatchRealtimeProps) {
  const { state, now } = useMatchLive();
  return <MatchRealtimeSurface state={state} now={now} {...props} />;
}

/** Same surface for waiting, gameplay and inter-map; canonical context stays authoritative. */
export function MatchRealtimeSurface({ state, now, phase, currentMapId, assetBaseUrl }: {
  state: LiveViewerState;
  now: number;
  phase: LivePhase;
  currentMapId: string | null;
  assetBaseUrl?: string;
}) {
  const freshness = liveFreshness(state, now);
  const snapshot = visibleLiveSnapshot(state, now, phase, currentMapId);
  const showLive = snapshot !== null;
  const bomb = showLive ? presentBomb(snapshot.bomb) : null;
  return <section className="min-w-0 space-y-4" aria-label="实时比赛数据" data-testid="match-realtime">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
      <h2 className="text-lg font-semibold">比赛数据</h2>
      <span role="status" className={`text-sm ${showLive && freshness === "fresh" ? "text-[var(--color-ok)]" : "text-[var(--color-fg-dim)]"}`}>
        {showLive ? freshness === "fresh" ? "● 实时" : "实时数据暂时中断" : phase === "awaiting_gameplay" ? "等待正式对局" : phase === "inter_map" ? "图间休息" : "实时数据暂不可用"}
      </span>
    </div>
    {showLive ? <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="font-semibold">{mapLabel(snapshot.map.name ?? "")} <span className="ml-2 text-sm font-normal text-[var(--color-fg-mid)]">第 {snapshot.map.roundNumber ?? "—"} 回合</span></p>
          <p className="mt-1 text-xs text-[var(--color-fg-dim)]">{presentLivePhase(snapshot.roundPhase)}{bomb ? ` · ${bomb}` : ""}</p></div>
        <div className="flex items-center gap-4 font-mono tabular-nums"><span className="text-xs text-[var(--color-fg-dim)]">地图胜场 {snapshot.series.scoreA ?? "—"} : {snapshot.series.scoreB ?? "—"}</span><span className="text-2xl font-bold" aria-label="回合时钟">{formatLiveClock(liveClockSeconds(state, now))}</span></div>
      </div>
      <div className="grid min-w-0 items-stretch gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-rows-2 gap-3">
          <LiveTeamTable snapshot={snapshot} side="CT" />
          <LiveTeamTable snapshot={snapshot} side="T" />
        </div>
        <MatchRadar snapshot={snapshot} freshness={freshness} revision={state.revision} sequence={state.acceptedFrames} assetBaseUrl={assetBaseUrl} />
      </div>
      <RoundHistory snapshot={snapshot} />
    </> : <div className="border-l-2 border-[var(--color-border)] py-2 pl-4 text-sm leading-6 text-[var(--color-fg-mid)]">
      {phase === "awaiting_gameplay" ? "地图已确定。比赛开始后，在这里查看选手数据与战术雷达。" : phase === "inter_map" ? "本图已结束，可查看已确认的地图结果。下一图开始后继续更新。" : "请先查看已确认的地图与比赛结果，实时数据恢复后将自动更新。"}
    </div>}
  </section>;
}

function LiveTeamTable({ snapshot, side }: { snapshot: PublicLiveMatchProjection; side: "CT" | "T" }) {
  const team = side === "CT" ? snapshot.teams.ct : snapshot.teams.t;
  const score = side === "CT" ? snapshot.map.scoreCT : snapshot.map.scoreT;
  const players = snapshot.players.filter(player => player.side === side);
  return <div className="flex min-w-0 flex-col overflow-hidden border border-[var(--color-border)]">
    <div className="flex items-center justify-between gap-3 bg-[var(--color-panel-hi)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2"><span className={`font-mono text-xs font-bold ${side === "CT" ? "text-[var(--color-info)]" : "text-[var(--color-warn)]"}`}>{side}</span><h3 className="truncate text-sm font-semibold">{team.name}</h3></div>
      <span className="flex items-baseline gap-2"><span className="text-xs text-[var(--color-fg-dim)]">本图回合</span><span className="font-mono text-xl font-bold tabular-nums">{score ?? "—"}</span></span>
    </div>
    <div className="flex-1 overflow-x-auto">
      <table className="h-full w-full min-w-[400px] text-xs tabular-nums">
        <caption className="sr-only">{team.name} 选手基础数据</caption>
        <thead className="text-right text-[var(--color-fg-dim)]"><tr><th className="px-2 py-1.5 text-left font-normal">选手</th>{["HP", "护甲", "$", "K / A / D", "ADR"].map(label => <th key={label} className="whitespace-nowrap px-2 py-1.5 font-normal">{label}</th>)}</tr></thead>
        <tbody>{players.map(player => <tr key={player.sourcePlayerId} className={`border-t border-[var(--color-border)] ${player.lifeState === "dead" ? "text-[var(--color-fg-dim)]" : "text-[var(--color-fg)]"}`}>
          <th scope="row" className="max-w-32 px-2 py-1.5 text-left font-medium"><div className="truncate">{player.canonicalPlayerId ? <Link href={`/players/${player.canonicalPlayerId}`} className="hover:underline">{player.displayName ?? "未知选手"}</Link> : player.displayName ?? "未知选手"}</div><span className="sr-only">{player.lifeState === "alive" ? "存活" : player.lifeState === "dead" ? "阵亡" : "状态未知"}</span></th>
          <td className="px-2 py-1.5 text-right">{player.health ?? "—"}</td><td className="px-2 py-1.5 text-right">{player.armor ?? "—"}</td><td className="px-2 py-1.5 text-right">{player.money?.toLocaleString("en-US") ?? "—"}</td>
          <td className="whitespace-nowrap px-2 py-1.5 text-right">{player.stats.kills ?? "—"} / {player.stats.assists ?? "—"} / {player.stats.deaths ?? "—"}</td><td className="px-2 py-1.5 text-right">{player.stats.liveAdr?.toFixed(1) ?? "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {!players.length && <p className="p-3 text-sm text-[var(--color-fg-dim)]">选手数据暂不可用</p>}
  </div>;
}
function RoundHistory({ snapshot }: { snapshot: PublicLiveMatchProjection }) {
  const history = snapshot.roundHistory;
  if (!history || history.completeness === "unavailable") return <p className="text-xs text-[var(--color-fg-dim)]">回合记录暂不可用</p>;
  return <div className="space-y-2"><h3 className="text-xs text-[var(--color-fg-dim)]">回合记录{history.completeness === "partial" ? " · 部分回合" : ""}</h3><ol className="flex flex-wrap gap-1">{history.rounds.map(round => <li key={round.roundNumber} title={`第 ${round.roundNumber} 回合 · ${round.winnerSide === "unknown" ? "胜方未知" : `${round.winnerSide} 获胜`}`} className={`flex h-7 w-7 items-center justify-center border border-[var(--color-border)] font-mono text-xs ${round.winnerSide === "CT" ? "text-[var(--color-info)]" : round.winnerSide === "T" ? "text-[var(--color-warn)]" : "text-[var(--color-fg-dim)]"}`}>{round.roundNumber}<span className="sr-only">{round.winnerSide === "unknown" ? "胜方未知" : `${round.winnerSide} 获胜`}</span></li>)}</ol></div>;
}
