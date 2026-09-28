"use client";

import { useEffect, useState } from "react";
import { createLiveViewerClient } from "@/lib/auth/supabase";
import { Panel } from "@/components/rivalhub";
import { mergeLiveDelivery, liveFreshness, type PublicLiveMatchProjection } from "@/lib/mizar/live-projection";
import { presentLiveBomb } from "@/lib/mizar/live-presentation";
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
      {radar.bomb?.position?.layer === layer && <span className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded bg-yellow-400 px-1 text-xs font-bold text-black" style={pointStyle(radar.bomb.position)}>C4</span>}
      {radar.players.filter(player => player.position?.layer === layer).map(player => <span key={player.sourcePlayerId} title={live.players.find(person => person.sourcePlayerId === player.sourcePlayerId)?.displayName ?? undefined}
        className={`absolute z-30 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white transition-[left,top] duration-700 ease-linear ${player.side === "CT" ? "border-sky-300 bg-sky-700" : "border-amber-300 bg-amber-700"} ${player.lifeState === "dead" ? "opacity-40" : ""}`}
        style={pointStyle(player.position!)}>{player.side === "CT" ? "CT" : player.side === "T" ? "T" : "?"}</span>)}
    </div>
  </div>;
}

export function MatchLiveProjection({ matchId, entryAId, entryBId, teamAName, teamBName }: { matchId: string; entryAId: string; entryBId: string; teamAName: string; teamBName: string }) {
  const [delivery, setDelivery] = useState<{ live: PublicLiveMatchProjection; arrivedAt: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 500);
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
        const arrivedAt = performance.now();
        setDelivery(current => {
          const merged = mergeLiveDelivery(current?.live ?? null, next, matchId);
          return merged && merged !== current?.live ? { live: merged, arrivedAt } : current;
        });
      }).subscribe(status => setConnected(status === "SUBSCRIBED"));
    })();
    return () => { cancelled = true; if (client) void client.removeAllChannels(); setConnected(false); setDelivery(null); };
  }, [matchId]);
  const live = delivery?.live;
  const freshness = delivery && connected ? liveFreshness(now - delivery.arrivedAt) : "unavailable";
  if (freshness !== "fresh" || !live) return <Panel label="正式对局" contentClassName="p-5"><p role="status" className="text-sm text-[var(--color-fg-mid)]">{freshness === "stale" ? "实时数据暂时中断，等待恢复。" : "等待正式对局实时数据；赛程与赛果以页面记录为准。"}</p></Panel>;
  const mapScoreA = live.teams.ct.entryId === entryAId ? live.map.scoreCT : live.teams.t.entryId === entryAId ? live.map.scoreT : null;
  const mapScoreB = live.teams.ct.entryId === entryBId ? live.map.scoreCT : live.teams.t.entryId === entryBId ? live.map.scoreT : null;
  const score = `${mapScoreA ?? "–"} : ${mapScoreB ?? "–"}`;
  const teamName = (entryId: string | null) => entryId === entryAId ? teamAName : entryId === entryBId ? teamBName : "队伍";
  const currentPlayers = live.players.filter(player => player.lineupEvidence === "current");
  const playerTable = (side: "CT" | "T", entryId: string | null) => <section className="min-w-0">
    <div className="mb-1 flex items-center justify-between rounded bg-[var(--color-panel-lo)] px-3 py-2 text-sm font-semibold"><span className="truncate">{teamName(entryId)}</span><span className="ml-2 text-xs text-[var(--color-fg-mid)]">{side}</span></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[540px] table-fixed text-xs tabular-nums"><colgroup><col style={{ width: "27%" }} /><col style={{ width: "10%" }} /><col style={{ width: "12%" }} /><col style={{ width: "13%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} /><col style={{ width: "11%" }} /></colgroup><thead><tr className="text-[var(--color-fg-mid)]"><th className="px-2 py-1 text-left">选手</th>{["HP", "护甲", "$", "K", "A", "D", "ADR"].map(label => <th key={label} className="px-1 py-1 text-right">{label}</th>)}</tr></thead><tbody>
      {currentPlayers.filter(player => player.side === side).map(player => <tr key={player.sourcePlayerId} className="border-t border-[var(--color-border)]"><td className="min-w-0 truncate px-2 py-2 text-left font-medium" title={player.displayName ?? undefined}>{player.displayName ?? "未知选手"}</td><td className="px-1 text-right">{player.health ?? "–"}</td><td className="px-1 text-right">{player.armor ?? "–"}</td><td className="px-1 text-right">{player.money ?? "–"}</td><td className="px-1 text-right">{player.stats.kills ?? "–"}</td><td className="px-1 text-right">{player.stats.assists ?? "–"}</td><td className="px-1 text-right">{player.stats.deaths ?? "–"}</td><td className="px-1 text-right">{player.stats.liveAdr?.toFixed(1) ?? "–"}</td></tr>)}
    </tbody></table></div>
  </section>;
  return <div className="space-y-4" aria-live="polite">
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,63fr)_minmax(0,37fr)]">
      <Panel label="正式对局" contentClassName="min-w-0 space-y-5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-4">
          <div className="min-w-0"><p className="text-xs text-[var(--color-fg-mid)]">{live.map.name ?? "地图待定"} · 第 {live.map.roundNumber ?? "–"} 回合</p><p className="mt-1 truncate text-lg font-bold">{teamAName} <span className="font-mono tabular-nums">{score}</span> {teamBName}</p><p className="mt-1 text-xs text-[var(--color-fg-mid)]">CT {live.map.scoreCT ?? "–"} : {live.map.scoreT ?? "–"} T</p></div>
          <div className="text-right"><p className="font-mono text-2xl tabular-nums">{live.clock?.remainingSeconds == null ? "–" : `${Math.floor(live.clock.remainingSeconds / 60)}:${String(Math.floor(live.clock.remainingSeconds % 60)).padStart(2, "0")}`}</p><p className="text-xs text-[var(--color-fg-mid)]">{live.roundPhase ?? live.map.phase ?? ""}</p></div>
        </div>
        {playerTable("CT", live.teams.ct.entryId)}
        {playerTable("T", live.teams.t.entryId)}
      </Panel>
      <Panel label="实时雷达" contentClassName="p-4"><Radar live={live} /></Panel>
    </div>
    <Panel label="回合记录" contentClassName="space-y-3 p-4">
      <p className="rounded border border-[var(--color-border)] p-2 text-sm">{presentLiveBomb(live.bomb, live.players)}</p>
      {!live.roundHistory || live.roundHistory.completeness === "unavailable" ? <p className="text-sm text-[var(--color-fg-mid)]">回合记录暂不可用</p> : <div className="flex flex-wrap gap-1">{live.roundHistory.rounds.map(round => <span key={round.roundNumber} title={`第 ${round.roundNumber} 回合 · ${round.winCondition}`} className={`flex h-8 w-8 items-center justify-center rounded text-xs ${round.winnerEntryId === entryAId ? "bg-[var(--color-accent)] text-black" : round.winnerEntryId === entryBId ? "bg-[var(--color-accent-b)] text-black" : "bg-[var(--color-panel-lo)]"}`}>{round.roundNumber}</span>)}</div>}
    </Panel>
  </div>;
}
