"use client";

import { useEffect, useState, type CSSProperties, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { isBuiltInStarRank } from "@/lib/competitive/builtins";
import { presentCompetitiveRankSummary } from "@/lib/competitive/presentation";
import { sourceLabel } from "./MajorStrengthStarterSummary";
import type { MajorStrengthFact, MajorStrengthStarter } from "@/lib/admin/season-workspace/types";
import { moveRankingEntry } from "@/lib/admin/season-workspace/ranking-order";

export type RankingMember = MajorStrengthStarter & { isPrimaryStarter: boolean };
export type RankingTeam = {
  entryId: string;
  teamName: string;
  systemRank: number | null;
  tieState?: "not_ranked" | "not_tied" | "tied";
  members: RankingMember[];
  preliminaryRank?: number | null;
  route?: string;
  result?: string;
};

type Props = {
  mode: "reference" | "preliminary" | "final";
  teams: RankingTeam[];
  order: string[];
  onOrderChange?: (order: string[]) => void;
  platform: string | null;
  boundaryAfter?: number;
  boundaryLabel?: string;
  cohortBoundaries?: Array<{ after: number; label: string }>;
};

const ZOOMS = [75, 90, 100, 110, 125] as const;
const STORAGE_KEY = "rivalhub-major-ranking-preferences";

function rankText(fact: MajorStrengthFact | null, platform: string | null): string {
  if (!fact) return "—";
  return presentCompetitiveRankSummary(fact.rank, fact.stars, isBuiltInStarRank(platform ?? "perfect_world", fact.rank));
}

function PlayerCell({ member, platform }: { member: RankingMember; platform: string | null }) {
  const facts = [
    ["今", member.presentation.currentSeasonPeak],
    ["近", member.presentation.recentPeak],
    ["前", member.presentation.referenceSeasonPeak],
    ["史", member.presentation.historicalPeak],
  ] as const;
  return <details className="group min-w-0">
    <summary className="cursor-pointer list-none focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">
      <span className="flex items-center gap-1 truncate font-medium text-[var(--color-fg)]">
        <PlayerProfileLink userId={member.userId} className="truncate" onClick={(event) => event.stopPropagation()}>{member.label}</PlayerProfileLink>
        <span className="shrink-0 rounded border border-[var(--color-border)] px-1 text-[.9em] text-[var(--color-fg-mid)]">{member.isPrimaryStarter ? "主" : "替"}</span>
      </span>
      <span className="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[var(--color-fg-mid)]">
        {facts.map(([label, fact]) => <span key={label} className="truncate whitespace-nowrap"><b className="font-normal text-[var(--color-fg-dim)]">{label}</b> {rankText(fact, platform)}</span>)}
      </span>
    </summary>
    <div className="mt-2 min-w-48 border-t border-[var(--color-border)] pt-2 text-[.95em] text-[var(--color-fg-mid)]">
      {facts.map(([label, fact]) => <p key={label}>{label}：{rankText(fact, platform)}{fact?.sourcePlatform ? ` · ${sourceLabel(fact.sourcePlatform)}` : ""}{fact?.sourceSeasonKey ? ` · ${fact.sourceSeasonKey}` : ""}{fact?.sourceRank ? ` · 原始 ${fact.sourceRank}${fact.sourceStars === null ? "" : ` ${fact.sourceStars} 星`}` : ""}{fact?.conversionVersion ? ` · 换算 ${fact.conversionVersion}` : ""}</p>)}
      {member.presentation.historicalRating !== null && <p>历史 Rating {member.presentation.historicalRating}</p>}
      {member.presentation.blockers.map((blocker) => <p key={blocker} className="text-[var(--color-warn)]">{blocker}</p>)}
    </div>
  </details>;
}

function MoveControl({ rank, total, onMove }: { rank: number; total: number; onMove: (rank: number) => void }) {
  const [target, setTarget] = useState(String(rank));
  return <form className="flex items-center gap-1" onSubmit={(event) => {
    event.preventDefault();
    const value = Number(target);
    if (Number.isInteger(value) && value >= 1 && value <= total) onMove(value);
    else setTarget(String(rank));
  }}>
    <label className="sr-only" htmlFor={`ranking-move-${rank}`}>移至排名</label>
    <input id={`ranking-move-${rank}`} type="number" min={1} max={total} value={target} onChange={(event) => setTarget(event.target.value)} className="w-10 rounded border border-[var(--color-border)] bg-transparent px-1 py-0.5 text-center" />
    <button type="submit" className="text-[var(--color-accent)] underline">移至</button>
  </form>;
}

export function MajorRankingWorkspace({ mode, teams, order, onOrderChange, platform, boundaryAfter, boundaryLabel, cohortBoundaries = [] }: Props) {
  const [zoom, setZoom] = useState<number>(100);
  const [overview, setOverview] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { zoom?: number; overview?: boolean } | null;
      const frame = requestAnimationFrame(() => {
        if (stored && ZOOMS.some((value) => value === stored.zoom)) setZoom(stored.zoom!);
        if (stored && typeof stored.overview === "boolean") setOverview(stored.overview);
      });
      return () => cancelAnimationFrame(frame);
    } catch { /* Ignore a stale preference. */ }
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ zoom, overview }));
  }, [zoom, overview]);
  const factor = zoom / 100 * (overview ? .84 : 1);
  const style = {
    "--matrix-font": `${Math.max(9, 11 * factor)}px`,
    "--matrix-player-width": `${Math.round(170 * factor)}px`,
    "--matrix-team-width": `${Math.round(178 * factor)}px`,
    "--matrix-pad-x": `${Math.round(8 * factor)}px`,
    "--matrix-pad-y": `${Math.round(5 * factor)}px`,
    "--matrix-row-height": `${Math.round(65 * factor)}px`,
  } as CSSProperties;
  const byId = new Map(teams.map((team) => [team.entryId, team]));
  const ordered = order.map((id) => byId.get(id)).filter((team): team is RankingTeam => Boolean(team));
  const maxMembers = Math.max(5, ...ordered.map((team) => team.members.length));
  const editable = Boolean(onOrderChange);
  const move = (entryId: string, targetRank: number) => {
    if (!onOrderChange) return;
    const next = moveRankingEntry(order, entryId, targetRank);
    if (next.some((id, index) => id !== order[index])) onOrderChange(next);
  };
  const drop = (event: DragEvent<HTMLTableRowElement>, targetRank: number) => {
    event.preventDefault();
    if (draggingId) move(draggingId, targetRank);
    setDraggingId(null);
  };
  const rankLabel = mode === "reference" ? "系统参考" : mode === "preliminary" ? "预排名" : "最终种子";
  return <section style={style} aria-label={`${rankLabel}工作台`} className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-fg-mid)]">
      <p>系统参考仅按 5 名预定主力计算；完整名单供赛委会综合判断。</p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" aria-label="缩小矩阵" disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom as typeof ZOOMS[number]) - 1)]!)}>−</Button>
        <span className="w-9 text-center tabular-nums">{zoom}%</span>
        <Button type="button" size="sm" variant="ghost" aria-label="放大矩阵" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom as typeof ZOOMS[number]) + 1)]!)}>+</Button>
        <Button type="button" size="sm" variant={overview ? "outline" : "ghost"} aria-pressed={overview} onClick={() => setOverview(!overview)}>{overview ? "正常" : "概览"}</Button>
      </div>
    </div>
    <div className="overflow-x-auto border border-[var(--color-border)]">
      <table className="border-separate border-spacing-0 text-left [font-size:var(--matrix-font)]" style={{ minWidth: "100%" }}>
        <thead className="text-[var(--color-fg-mid)]"><tr>
          <th className="sticky left-0 top-0 z-30 w-20 min-w-20 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-[var(--matrix-pad-x)] py-2">{rankLabel}</th>
          {mode !== "reference" && <th className="sticky left-20 top-0 z-30 w-16 min-w-16 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-1 py-2">系统参考</th>}
          <th className={`sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-[var(--matrix-pad-x)] py-2 ${mode === "reference" ? "left-20" : "left-36"}`} style={{ minWidth: "var(--matrix-team-width)" }}>队伍</th>
          {mode === "final" && <th className="sticky top-0 z-20 min-w-32 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-2 py-2">原预排 · 资格路径</th>}
          {Array.from({ length: maxMembers }, (_, index) => <th key={index} className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-[var(--matrix-pad-x)] py-2" style={{ minWidth: "var(--matrix-player-width)" }}>选手 {index + 1}</th>)}
        </tr></thead>
        <tbody>{ordered.map((team, index) => {
          const rank = index + 1;
          const direct = boundaryAfter !== undefined && rank <= boundaryAfter;
          const boundary = cohortBoundaries.find((item) => item.after === rank - 1);
          return <tr key={team.entryId} draggable={editable} onDragStart={() => setDraggingId(team.entryId)} onDragEnd={() => setDraggingId(null)} onDragOver={(event) => { if (editable) event.preventDefault(); }} onDrop={(event) => drop(event, rank)} className={`${draggingId === team.entryId ? "opacity-45" : ""} ${boundary || rank === (boundaryAfter ?? -1) + 1 ? "[&>td]:border-t-2 [&>td]:border-t-[var(--color-accent)]" : ""} ${direct ? "bg-[var(--color-panel-low)]" : ""}`} style={{ height: "var(--matrix-row-height)" }}>
            <td className="sticky left-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--matrix-pad-x)] py-[var(--matrix-pad-y)] align-middle tabular-nums">
              <strong>{mode === "reference" && team.systemRank === null ? "—" : `#${mode === "reference" ? team.systemRank : rank}`}{mode === "reference" && team.tieState === "tied" ? " 并列" : ""}</strong>
              {editable && <div className="mt-0.5 flex items-center gap-0.5"><button type="button" aria-label={`将${team.teamName}上移`} disabled={index === 0} onClick={() => move(team.entryId, rank - 1)} className="disabled:opacity-30">↑</button><button type="button" aria-label={`将${team.teamName}下移`} disabled={index === order.length - 1} onClick={() => move(team.entryId, rank + 1)} className="disabled:opacity-30">↓</button></div>}
            </td>
            {mode !== "reference" && <td className="sticky left-20 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-[var(--matrix-pad-y)] align-middle tabular-nums">{team.systemRank === null ? "—" : `#${team.systemRank}`}{team.tieState === "tied" ? " 并列" : ""}</td>}
            <td className={`sticky z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--matrix-pad-x)] py-[var(--matrix-pad-y)] align-middle ${mode === "reference" ? "left-20" : "left-36"}`} style={{ minWidth: "var(--matrix-team-width)" }}>
              <strong className="block truncate" title={team.teamName}>{team.teamName}</strong>
              {editable ? <MoveControl key={`${team.entryId}:${rank}`} rank={rank} total={order.length} onMove={(target) => move(team.entryId, target)} /> : <span className="text-[var(--color-fg-mid)]">{team.route ?? (direct ? "直通正赛" : boundaryAfter !== undefined ? "Play-in" : "")}</span>}
              {boundary && <span className="block text-[var(--color-accent)]">{boundary.label}</span>}
              {rank === (boundaryAfter ?? -1) + 1 && <span className="block text-[var(--color-accent)]">{boundaryLabel ?? "Play-in"}</span>}
            </td>
            {mode === "final" && <td className="border-b border-[var(--color-border)] px-2 py-[var(--matrix-pad-y)] text-[var(--color-fg-mid)]">{team.preliminaryRank ? `原 #${team.preliminaryRank}` : "—"}<br />{team.route ?? "—"}{team.result ? ` · ${team.result}` : ""}</td>}
            {Array.from({ length: maxMembers }, (_, memberIndex) => <td key={memberIndex} className="border-b border-[var(--color-border)] px-[var(--matrix-pad-x)] py-[var(--matrix-pad-y)] align-middle" style={{ minWidth: "var(--matrix-player-width)" }}>{team.members[memberIndex] && <PlayerCell member={team.members[memberIndex]} platform={platform} />}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}
