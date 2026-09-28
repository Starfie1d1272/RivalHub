"use client";

import { useEffect, useState } from "react";
import { createLiveViewerClient } from "@/lib/auth/supabase";
import { Panel } from "@/components/rivalhub";
import { acceptsLiveDelivery, liveFreshness, type PublicLiveMatchProjection } from "@/lib/mizar/live-projection";
import { CS2_RADAR_ASSETS } from "./cs2-radar-assets";

type ViewerCredential = { token: string; topic: string };
const radarUrls: Record<string, Record<string, string>> = CS2_RADAR_ASSETS;

function Radar({ live }: { live: PublicLiveMatchProjection }) {
  const radar = live.radar;
  if (!radar || !live.capability.radarCurrent) return <p className="text-sm text-[var(--color-fg-mid)]">当前地图雷达暂不可用</p>;
  const layer = radar.activeLayer ?? radar.layers[0];
  const image = radarUrls[radar.mapName]?.[layer === "single" ? "overview" : layer] ?? radarUrls[radar.mapName]?.overview;
  if (!image) return <p className="text-sm text-[var(--color-fg-mid)]">当前地图没有可用雷达底图</p>;
  const pointStyle = (point: { x: number; y: number }) => ({ left: `${point.x * 100}%`, top: `${point.y * 100}%` });
  return <div>
    <div className="mb-2 flex items-center justify-between text-xs text-[var(--color-fg-mid)]"><span>{radar.mapName.replace(/^de_/, "").toUpperCase()}</span><span>{layer === "lower" ? "下层" : layer === "upper" ? "上层" : "全图"}</span></div>
    <div className="relative aspect-square w-full overflow-hidden rounded border border-[var(--color-border)] bg-black" aria-label="比赛实时雷达">
      {/* Mizar owns world-to-overview calibration. These are imported Valve overviews. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="" className="absolute inset-0 h-full w-full object-contain opacity-85" />
      {radar.utility.filter(item => item.position?.layer === layer).flatMap(item => [
        ...(item.position ? [{ key: item.sourceEntityId, position: item.position, label: item.kind === "smokegrenade" ? "烟" : item.kind === "inferno" ? "火" : "道" }] : []),
        ...item.flames.filter(flame => flame.position.layer === layer).map(flame => ({ key: `${item.sourceEntityId}-${flame.sourceFlameId}`, position: flame.position, label: "火" })),
      ]).map(item => <span key={item.key} className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/75 px-1 text-[9px] text-black" style={pointStyle(item.position)}>{item.label}</span>)}
      {radar.bomb?.position?.layer === layer && <span className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded bg-yellow-400 px-1 text-xs font-bold text-black" style={pointStyle(radar.bomb.position)}>C4</span>}
      {radar.players.filter(player => player.position?.layer === layer).map(player => <span key={player.sourcePlayerId} title={live.players.find(person => person.sourcePlayerId === player.sourcePlayerId)?.displayName ?? undefined}
        className={`absolute z-30 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white transition-[left,top] duration-700 ease-linear ${player.side === "CT" ? "border-sky-300 bg-sky-700" : "border-amber-300 bg-amber-700"} ${player.lifeState === "dead" ? "opacity-40" : ""}`}
        style={pointStyle(player.position!)}>{player.side === "CT" ? "CT" : player.side === "T" ? "T" : "?"}</span>)}
    </div>
  </div>;
}

export function MatchLiveProjection({ matchId, teamAName, teamBName }: { matchId: string; teamAName: string; teamBName: string }) {
  const [live, setLive] = useState<PublicLiveMatchProjection | null>(null);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const credential = async (): Promise<ViewerCredential | null> => {
      const response = await fetch(`/api/matches/${matchId}/live-viewer`, { cache: "no-store" });
      return response.ok ? response.json() as Promise<ViewerCredential> : null;
    };
    let client: ReturnType<typeof createLiveViewerClient> | null = null;
    void (async () => {
      const first = await credential().catch(() => null);
      if (!first || cancelled) return;
      client = createLiveViewerClient(async () => (await credential().catch(() => null))?.token ?? null);
      const channel = client.channel(first.topic, { config: { private: true } });
      channel.on("broadcast", { event: "snapshot" }, ({ payload }) => {
        const next = payload as PublicLiveMatchProjection;
        setLive(current => acceptsLiveDelivery(current, next, matchId) ? next : current);
      }).subscribe(status => setConnected(status === "SUBSCRIBED"));
    })();
    return () => { cancelled = true; if (client) void client.removeAllChannels(); setConnected(false); setLive(null); };
  }, [matchId]);
  const freshness = live && connected ? liveFreshness(now - Date.parse(live.producedAt)) : "unavailable";
  if (freshness !== "fresh" || !live) return <Panel label="正式对局" contentClassName="p-5"><p role="status" className="text-sm text-[var(--color-fg-mid)]">{freshness === "stale" ? "实时数据暂时中断，等待恢复。" : "等待正式对局实时数据；赛程与赛果以页面记录为准。"}</p></Panel>;
  const score = `${live.series.scoreA ?? "–"} : ${live.series.scoreB ?? "–"}`;
  return <div className="space-y-4" aria-live="polite">
    <Panel label="正式对局" contentClassName="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs text-[var(--color-fg-mid)]">系列赛 · {live.map.name ?? "地图待定"} · 第 {live.map.roundNumber ?? "–"} 回合</p><p className="mt-1 text-3xl font-bold">{teamAName} <span className="font-mono">{score}</span> {teamBName}</p></div>
        <div className="text-right"><p className="text-sm">CT {live.map.scoreCT ?? "–"} : {live.map.scoreT ?? "–"} T</p><p className="font-mono text-lg">{live.clock?.remainingSeconds == null ? "–" : `${Math.floor(live.clock.remainingSeconds / 60)}:${String(Math.floor(live.clock.remainingSeconds % 60)).padStart(2, "0")}`}</p><p className="text-xs text-[var(--color-fg-mid)]">{live.roundPhase ?? live.map.phase ?? ""}</p></div>
      </div>
      {live.bomb?.action && <p className="rounded border border-[var(--color-warn-edge)] p-2 text-sm">{live.bomb.action.kind === "plant" ? "正在安放 C4" : "正在拆除 C4"}{live.bomb.action.remainingSeconds != null ? ` · ${Math.ceil(live.bomb.action.remainingSeconds)} 秒` : ""}</p>}
    </Panel>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel label="实时雷达" contentClassName="p-4"><Radar live={live} /></Panel>
      <div className="space-y-4">
        <Panel label="选手状态" contentClassName="overflow-x-auto p-3"><table className="w-full min-w-[400px] text-left text-xs"><thead><tr className="text-[var(--color-fg-mid)]"><th>选手</th><th>阵营</th><th>HP / 护甲</th><th>经济</th><th>K / A / D</th><th>ADR</th></tr></thead><tbody>{live.players.filter(player => player.lineupEvidence === "current").map(player => <tr key={player.sourcePlayerId} className="border-t border-[var(--color-border)]"><td className="py-2">{player.displayName ?? "未知选手"}</td><td>{player.side}</td><td>{player.health ?? "–"} / {player.armor ?? "–"}</td><td>{player.money ?? "–"}</td><td>{player.stats.kills ?? "–"} / {player.stats.assists ?? "–"} / {player.stats.deaths ?? "–"}</td><td>{player.stats.liveAdr?.toFixed(1) ?? "–"}</td></tr>)}</tbody></table></Panel>
        <Panel label="回合历史" contentClassName="p-4">{!live.roundHistory || live.roundHistory.completeness === "unavailable" ? <p className="text-sm text-[var(--color-fg-mid)]">回合历史暂不可用</p> : <><p className="mb-2 text-xs text-[var(--color-fg-mid)]">{live.roundHistory.completeness === "partial" ? "目前仅有部分回合记录" : "本图回合记录"}</p><div className="flex flex-wrap gap-1">{live.roundHistory.rounds.map(round => <span key={round.roundNumber} title={`第 ${round.roundNumber} 回合 · ${round.winCondition}`} className={`flex h-8 w-8 items-center justify-center rounded text-xs ${round.winnerSide === "CT" ? "bg-sky-800" : round.winnerSide === "T" ? "bg-amber-800" : "bg-[var(--color-panel-lo)]"}`}>{round.roundNumber}</span>)}</div></>}</Panel>
      </div>
    </div>
  </div>;
}
