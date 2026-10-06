"use client";

import { useEffect, useState, type CSSProperties, type DragEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody } from "@/components/ui/dialog";
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

const ZOOMS = [90, 100, 110, 125] as const;
const STORAGE_KEY = "rivalhub-major-ranking-preferences";

function rankText(fact: MajorStrengthFact | null, platform: string | null): string {
  if (!fact) return "—";
  if (fact.estimatedFromUnranked) return `未定级 · 参考 ${fact.rank}`;
  return presentCompetitiveRankSummary(fact.rank, fact.stars, isBuiltInStarRank(platform ?? "perfect_world", fact.rank));
}

function compactRank(fact: MajorStrengthFact | null): string {
  if (!fact) return "—";
  const short = ({ "青铜S": "铜", "黄金S": "金", "钻石S": "钻", "魔王S": "魔" } as Record<string, string>)[fact.rank];
  return short ? `${short}${fact.stars ?? "?"}` : `${fact.rank}${fact.stars === null ? "" : fact.stars}`;
}

function rankTone(fact: MajorStrengthFact | null): string {
  if (!fact) return "text-[var(--color-fg-dim)]";
  if (["青铜S", "黄金S", "钻石S", "魔王S", "S", "SS", "SSS"].includes(fact.rank)) return "border-violet-400/40 bg-violet-400/10 text-violet-600 dark:text-violet-300";
  if (fact.rank.startsWith("A")) return "border-blue-400/40 bg-blue-400/10 text-blue-600 dark:text-blue-300";
  if (fact.rank.startsWith("B")) return "border-emerald-400/40 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300";
  return "border-[var(--color-border)] text-[var(--color-fg-mid)]";
}

function PlayerCell({ member, platform }: { member: RankingMember; platform: string | null }) {
  const [open, setOpen] = useState(false);
  const facts = [
    ["今", member.presentation.currentSeasonPeak], ["近", member.presentation.recentPeak],
    ["前", member.presentation.referenceSeasonPeak], ["史", member.presentation.historicalPeak],
  ] as const;
  const flagged = member.presentation.blockers.length > 0 || facts.some(([, fact]) => fact?.estimatedFromUnranked);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label={`${member.label}，${member.isPrimaryStarter ? "主力" : "替补"}，查看实力证据`}
      className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded px-0.5 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      title={`${member.label} · ${member.isPrimaryStarter ? "主力" : "替补"} · 近 ${rankText(member.presentation.recentPeak, platform)} · 史 ${rankText(member.presentation.historicalPeak, platform)}${flagged ? " · 资料需关注" : ""}`}>
      <span className="max-w-[10em] truncate font-medium text-[var(--color-fg)]">{member.label}</span>
      <span aria-label="近期有效段位" className={`rounded border px-0.5 tabular-nums ${rankTone(member.presentation.recentPeak)}`}>{compactRank(member.presentation.recentPeak)}</span>
      {member.isPrimaryStarter && <span aria-label="历史最高段位" className="text-[var(--color-fg-mid)]">史{compactRank(member.presentation.historicalPeak)}</span>}
      {member.isPrimaryStarter && member.presentation.historicalRating !== null && <span className="tabular-nums text-[var(--color-fg-mid)]">R{member.presentation.historicalRating.toFixed(2)}</span>}
      {flagged && <span aria-label="资料需关注" className="text-[var(--color-warn)]">·</span>}
    </button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogHeader><DialogTitle>{member.label} · {member.isPrimaryStarter ? "主力" : "替补"}</DialogTitle><DialogDescription>本届统一段位与来源证据</DialogDescription></DialogHeader>
      <DialogBody className="space-y-2 text-sm">
        <PlayerProfileLink userId={member.userId}>查看选手资料</PlayerProfileLink>
        {facts.map(([label, fact]) => <p key={label}>{label}：{rankText(fact, platform)}{fact?.estimatedFromSeasonKey ? ` · 按 ${fact.estimatedFromSeasonKey} 已定级记录下一档估算` : fact?.estimatedFromHistorical ? " · 无逐赛季已定级记录，按历史最高下一档估算" : ""}{fact?.sourcePlatform ? ` · ${sourceLabel(fact.sourcePlatform)}` : ""}{fact?.sourceSeasonKey ? ` · ${fact.sourceSeasonKey}` : ""}{fact?.sourceRank ? ` · 原始 ${fact.sourceRank}${fact.sourceStars === null ? "" : ` ${fact.sourceStars} 星`}` : ""}{fact?.conversionVersion ? ` · 换算 ${fact.conversionVersion}` : ""}</p>)}
        {member.presentation.historicalRating !== null && <p>可比较历史 Rating {member.presentation.historicalRating}</p>}
        {member.presentation.blockers.map(blocker => <p key={blocker} className="text-[var(--color-warn)]">{blocker}</p>)}
      </DialogBody>
    </DialogContent></Dialog>
  </>;
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
  const factor = zoom / 100;
  const style = {
    "--matrix-font": `${Math.max(9, 11 * factor)}px`,
    "--matrix-team-width": `${Math.round(140 * factor)}px`,
    "--matrix-pad-x": `${Math.round(4 * factor)}px`,
    "--matrix-pad-y": `${Math.round(2 * factor)}px`,
    "--matrix-row-height": `${Math.round((overview ? 24 : 28) * factor)}px`,
  } as CSSProperties;
  const byId = new Map(teams.map((team) => [team.entryId, team]));
  const ordered = order.map((id) => byId.get(id)).filter((team): team is RankingTeam => Boolean(team));
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
      <p>系统参考仅计算 5 名主力；细线右侧为替补。近：彩色段位 · 史：历史最高 · R：可比较 Rating。{boundaryAfter !== undefined ? ` 前 ${boundaryAfter} 队直通，其余 Play-in。` : ""}</p>
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
          <th className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-1 py-2">完整阵容 · 主力 / 替补</th>
        </tr></thead>
        <tbody>{ordered.map((team, index) => {
          const rank = index + 1;
          const direct = boundaryAfter !== undefined && rank <= boundaryAfter;
          const boundary = cohortBoundaries.find((item) => item.after === rank - 1);
          return <tr key={team.entryId} draggable={editable} onDragStart={() => setDraggingId(team.entryId)} onDragEnd={() => setDraggingId(null)} onDragOver={(event) => { if (editable) event.preventDefault(); }} onDrop={(event) => drop(event, rank)} className={`${draggingId === team.entryId ? "opacity-45" : ""} ${boundary || rank === (boundaryAfter ?? -1) + 1 ? "[&>td]:border-t-2 [&>td]:border-t-[var(--color-accent)]" : ""} ${direct ? "bg-[var(--color-panel-low)]" : ""}`} style={{ height: "var(--matrix-row-height)" }}>
            <td className="sticky left-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--matrix-pad-x)] py-[var(--matrix-pad-y)] align-middle tabular-nums">
              <strong>{mode === "reference" && team.systemRank === null ? "—" : `#${mode === "reference" ? team.systemRank : rank}`}{mode === "reference" && team.tieState === "tied" ? " 并列" : ""}</strong>
              {editable && <span className="ml-1 inline-flex items-center gap-0.5"><button type="button" aria-label={`将${team.teamName}上移`} disabled={index === 0} onClick={() => move(team.entryId, rank - 1)} className="disabled:opacity-30">↑</button><button type="button" aria-label={`将${team.teamName}下移`} disabled={index === order.length - 1} onClick={() => move(team.entryId, rank + 1)} className="disabled:opacity-30">↓</button></span>}
            </td>
            {mode !== "reference" && <td className="sticky left-20 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-[var(--matrix-pad-y)] align-middle tabular-nums">{team.systemRank === null ? "—" : `#${team.systemRank}`}{team.tieState === "tied" ? " 并列" : team.systemRank !== null && team.systemRank !== rank ? <span className="ml-1 text-[var(--color-fg-mid)]" aria-label={`人工${team.systemRank > rank ? "上调" : "下调"}${Math.abs(team.systemRank - rank)}位`}>{team.systemRank > rank ? "↑" : "↓"}{Math.abs(team.systemRank - rank)}</span> : ""}</td>}
            <td className={`sticky z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--matrix-pad-x)] py-[var(--matrix-pad-y)] align-middle ${mode === "reference" ? "left-20" : "left-36"}`} style={{ minWidth: "var(--matrix-team-width)" }}>
              <strong className="inline-block max-w-36 truncate align-middle" title={team.teamName}>{team.teamName}</strong>
              {editable ? <span className="ml-1 inline-block align-middle"><MoveControl key={`${team.entryId}:${rank}`} rank={rank} total={order.length} onMove={(target) => move(team.entryId, target)} /></span> : <span className="text-[var(--color-fg-mid)]">{team.route ?? (direct ? "直通正赛" : boundaryAfter !== undefined ? "Play-in" : "")}</span>}
              {boundary && <span className="sr-only">{boundary.label}</span>}
              {rank === (boundaryAfter ?? -1) + 1 && <span className="sr-only">{boundaryLabel ?? "Play-in"}</span>}
            </td>
            {mode === "final" && <td className="border-b border-[var(--color-border)] px-2 py-[var(--matrix-pad-y)] text-[var(--color-fg-mid)]">{team.preliminaryRank ? `原 #${team.preliminaryRank}` : "—"} · {team.route ?? "—"}{team.result ? ` · ${team.result}` : ""}</td>}
            <td className="border-b border-[var(--color-border)] px-1 py-[var(--matrix-pad-y)] align-middle">
              <div className="flex items-center gap-1 whitespace-nowrap">
                {team.members.filter(member => member.isPrimaryStarter).map(member => <PlayerCell key={member.userId} member={member} platform={platform} />)}
                {team.members.some(member => !member.isPrimaryStarter) && <span aria-label="替补" className="inline-flex items-center gap-1 border-l border-[var(--color-border)] pl-1">
                  {team.members.filter(member => !member.isPrimaryStarter).map(member => <PlayerCell key={member.userId} member={member} platform={platform} />)}
                </span>}
              </div>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}
