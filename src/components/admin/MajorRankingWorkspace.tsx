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

const ZOOMS = [50, 60, 75, 90, 100, 110, 125] as const;
const STORAGE_KEY = "rivalhub-major-ranking-preferences";

function rankText(fact: MajorStrengthFact | null, platform: string | null): string {
  if (!fact) return "—";
  const summary = presentCompetitiveRankSummary(fact.rank, fact.stars, isBuiltInStarRank(platform ?? "perfect_world", fact.rank));
  return fact.estimatedFromUnranked ? `未定级 · 参考 ${summary}` : summary;
}

function compactRank(fact: { rank: string; stars: number | null } | null): string {
  if (!fact) return "—";
  const short = ({ "青铜S": "铜", "黄金S": "金", "钻石S": "钻", "魔王S": "魔" } as Record<string, string>)[fact.rank];
  return short ? `${short}${fact.stars ?? "?"}` : `${fact.rank}${fact.stars === null ? "" : fact.stars}`;
}

function rankTone(fact: { rank: string } | null): string {
  if (!fact) return "text-[var(--color-fg-dim)]";
  if (fact.rank === "魔王S") return "text-rose-300 bg-rose-500/10";
  if (fact.rank === "钻石S") return "text-sky-300 bg-sky-500/10";
  if (fact.rank === "黄金S") return "text-yellow-300 bg-yellow-500/10";
  if (fact.rank === "青铜S") return "text-orange-300 bg-orange-500/10";
  if (fact.rank.startsWith("A")) return "bg-blue-400/10 text-blue-300";
  if (fact.rank.startsWith("B")) return "bg-emerald-400/10 text-emerald-300";
  return "text-[var(--color-fg-mid)]";
}

function PlayerCell({ member, selected, onSelect }: { member: RankingMember; selected: boolean; onSelect: () => void }) {
  const composite = member.presentation.compositeRank ?? null;
  const facts = [
    ["今", member.presentation.currentSeasonPeak], ["近", member.presentation.recentPeak],
    ["前", member.presentation.referenceSeasonPeak], ["史", member.presentation.historicalPeak],
  ] as const;
  const flagged = member.presentation.blockers.length > 0 || facts.some(([, fact]) => fact?.estimatedFromUnranked);
  return <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`${member.label}，${member.isPrimaryStarter ? "主力" : "替补"}，查看实力证据`}
    className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded px-0.5 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${selected ? "bg-[var(--color-accent)]/15 outline outline-[var(--color-accent)]" : ""}`} title={member.label}>
    <span className="max-w-[10em] truncate font-medium text-[var(--color-fg)]">{member.label}</span>
    <span aria-label="综合段位" className={`rounded px-0.5 tabular-nums ${rankTone(composite)}`}>{compactRank(composite)}</span>
    {flagged && <span aria-label="资料需关注" className="text-[var(--color-warn)]">·</span>}
  </button>;
}

function PlayerEvidence({ member, platform }: { member: RankingMember; platform: string | null }) {
  const facts = [["历史最高 H", member.presentation.historicalPeak], ["近期 R", member.presentation.recentPeak], ["参考赛季 P", member.presentation.referenceSeasonPeak], ["当前赛季", member.presentation.currentSeasonPeak]] as const;
  return <div className="space-y-3 text-sm">
    <p>综合段位：{compactRank(member.presentation.compositeRank ?? null)}</p>
    <PlayerProfileLink userId={member.userId}>查看选手资料</PlayerProfileLink>
    {facts.map(([label, fact]) => <p key={label}>{label}：{rankText(fact, platform)}{fact?.rating !== null && fact?.rating !== undefined ? ` · Rating ${fact.rating}` : ""}{fact?.estimatedFromSeasonKey ? ` · 按 ${fact.estimatedFromSeasonKey} 已定级记录下一档估算` : fact?.estimatedFromHistorical ? " · 无逐赛季已定级记录，按历史最高下一档估算" : ""}{fact?.sourcePlatform ? ` · ${sourceLabel(fact.sourcePlatform)}` : ""}{fact?.sourceSeasonKey ? ` · ${fact.sourceSeasonKey}` : ""}{fact?.sourceRank ? ` · 原始 ${fact.sourceRank}${fact.sourceStars === null ? "" : ` ${fact.sourceStars} 星`}` : ""}{fact?.conversionVersion ? ` · 换算 ${fact.conversionVersion}` : ""}</p>)}
    {member.presentation.historicalRating !== null && <p>可比较历史 Rating {member.presentation.historicalRating}</p>}
    {member.presentation.blockers.map(blocker => <p key={blocker} className="text-[var(--color-warn)]">{blocker}</p>)}
  </div>;
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
  const [selection, setSelection] = useState<{ entryId: string; userId: string } | null>(null);
  const [moveEntry, setMoveEntry] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { zoom?: number; overview?: boolean } | null;
      const frame = requestAnimationFrame(() => {
        if (stored && ZOOMS.some((value) => value === stored.zoom)) setZoom(stored.zoom!);

      });
      return () => cancelAnimationFrame(frame);
    } catch { /* Ignore a stale preference. */ }
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ zoom }));
  }, [zoom]);
  const factor = zoom / 100;
  const style = {
    "--matrix-font": `${Math.max(9, 11 * factor)}px`,
    "--matrix-team-width": `${Math.round(140 * factor)}px`,
    "--matrix-pad-x": `${Math.round(4 * factor)}px`,
    "--matrix-pad-y": `${Math.round(2 * factor)}px`,
    "--matrix-row-height": `${Math.round(28 * factor)}px`,
  } as CSSProperties;
  const byId = new Map(teams.map((team) => [team.entryId, team]));
  const ordered = order.map((id) => byId.get(id)).filter((team): team is RankingTeam => Boolean(team));
  const selected = selection ? byId.get(selection.entryId)?.members.find(member => member.userId === selection.userId) : null;
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
  return <section style={style} aria-label={`${rankLabel}工作台`} className="space-y-2" onKeyDown={event => { if (event.key === "Escape") setSelection(null); }}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-fg-mid)]">
      <p>系统参考仅计算 5 名主力；五个主力列与替补区显示昵称和综合段位，点击选手查看证据。{boundaryAfter !== undefined ? ` 前 ${boundaryAfter} 队直通，其余 Play-in。` : ""}</p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" aria-label="缩小矩阵" disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom as typeof ZOOMS[number]) - 1)]!)}>−</Button>
        <span className="w-9 text-center tabular-nums">{zoom}%</span>
        <Button type="button" size="sm" variant="ghost" aria-label="放大矩阵" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom as typeof ZOOMS[number]) + 1)]!)}>+</Button>

      </div>
    </div>
    <div className="flex items-start gap-3">
    <div className="min-w-0 flex-1 overflow-x-auto border border-[var(--color-border)]">
      <table className="border-separate border-spacing-0 text-left [font-size:var(--matrix-font)]" style={{ minWidth: "100%" }}>
        <thead className="text-[var(--color-fg-mid)]"><tr>
          <th className="sticky left-0 top-0 z-30 w-20 min-w-20 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-[var(--matrix-pad-x)] py-2">{rankLabel}</th>
          {mode !== "reference" && <th className="sticky left-20 top-0 z-30 w-16 min-w-16 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-1 py-2">系统参考</th>}
          <th className={`sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-[var(--matrix-pad-x)] py-2 ${mode === "reference" ? "left-20" : "left-36"}`} style={{ minWidth: "var(--matrix-team-width)" }}>队伍</th>
          {mode === "final" && <th className="sticky top-0 z-20 min-w-32 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-2 py-2">原预排 · 资格路径</th>}
          {Array.from({ length: 5 }, (_, index) => <th key={index} className="sticky top-0 z-20 w-36 min-w-36 border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-1 py-2">主力{index + 1}</th>)}
          <th className="sticky top-0 z-20 border-l border-b border-[var(--color-border)] bg-[var(--color-panel-low)] px-1 py-2">替补</th>
        </tr></thead>
        <tbody>{ordered.map((team, index) => {
          const rank = index + 1;
          const direct = boundaryAfter !== undefined && rank <= boundaryAfter;
          const boundary = cohortBoundaries.find((item) => item.after === rank - 1);
          return <tr key={team.entryId} onDragOver={(event) => { if (editable) event.preventDefault(); }} onDrop={(event) => drop(event, rank)} className={`group ${draggingId === team.entryId ? "opacity-45" : ""} ${boundary || rank === (boundaryAfter ?? -1) + 1 ? "[&>td]:border-t-2 [&>td]:border-t-[var(--color-accent)]" : ""} ${direct ? "bg-[var(--color-panel-low)]" : ""}`} style={{ height: "var(--matrix-row-height)" }}>
            <td className="sticky left-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--matrix-pad-x)] py-[var(--matrix-pad-y)] align-middle tabular-nums">
              <button type="button" draggable={editable} onDragStart={() => setDraggingId(team.entryId)} onDragEnd={() => setDraggingId(null)} disabled={!editable} onClick={() => setMoveEntry(team.entryId)} aria-label={`将${team.teamName}移至排名`} className="font-semibold focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">{mode === "reference" && team.systemRank === null ? "—" : `#${mode === "reference" ? team.systemRank : rank}`}{mode === "reference" && team.tieState === "tied" ? " 并列" : ""}</button>
              {editable && <span className="ml-1 inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"><button type="button" aria-label={`将${team.teamName}上移`} disabled={index === 0} onClick={() => move(team.entryId, rank - 1)} className="disabled:opacity-30">↑</button><button type="button" aria-label={`将${team.teamName}下移`} disabled={index === order.length - 1} onClick={() => move(team.entryId, rank + 1)} className="disabled:opacity-30">↓</button></span>}
            </td>
            {mode !== "reference" && <td className="sticky left-20 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-[var(--matrix-pad-y)] align-middle tabular-nums">{team.systemRank === null ? "—" : `#${team.systemRank}`}{team.tieState === "tied" ? " 并列" : team.systemRank !== null && team.systemRank !== rank ? <span className="ml-1 text-[var(--color-fg-mid)]" aria-label={`人工${team.systemRank > rank ? "上调" : "下调"}${Math.abs(team.systemRank - rank)}位`}>{team.systemRank > rank ? "↑" : "↓"}{Math.abs(team.systemRank - rank)}</span> : ""}</td>}
            <td className={`sticky z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--matrix-pad-x)] py-[var(--matrix-pad-y)] align-middle ${mode === "reference" ? "left-20" : "left-36"}`} style={{ minWidth: "var(--matrix-team-width)" }}>
              <strong className="inline-block max-w-36 truncate align-middle" title={team.teamName}>{team.teamName}</strong>

              {boundary && <span className="sr-only">{boundary.label}</span>}
              {rank === (boundaryAfter ?? -1) + 1 && <span className="sr-only">{boundaryLabel ?? "Play-in"}</span>}
            </td>
            {mode === "final" && <td className="border-b border-[var(--color-border)] px-2 py-[var(--matrix-pad-y)] text-[var(--color-fg-mid)]">{team.preliminaryRank ? `原 #${team.preliminaryRank}` : "—"} · {team.route ?? "—"}{team.result ? ` · ${team.result}` : ""}</td>}
            {Array.from({ length: 5 }, (_, slot) => {
              const member = team.members.filter(member => member.isPrimaryStarter)[slot];
              return <td key={slot} className="w-36 max-w-36 border-b border-[var(--color-border)] px-1 py-[var(--matrix-pad-y)] align-middle">{member ? <PlayerCell member={member} selected={selection?.entryId === team.entryId && selection.userId === member.userId} onSelect={() => setSelection({ entryId: team.entryId, userId: member.userId })} /> : "—"}</td>;
            })}
            <td className="border-l border-b border-[var(--color-border)] px-1 py-[var(--matrix-pad-y)] align-middle"><div className="flex items-center gap-2 whitespace-nowrap">
              {team.members.filter(member => !member.isPrimaryStarter).map(member => <PlayerCell key={member.userId} member={member} selected={selection?.entryId === team.entryId && selection.userId === member.userId} onSelect={() => setSelection({ entryId: team.entryId, userId: member.userId })} />)}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {selected && !mobile && <aside aria-label="选手实力证据" className="sticky top-20 max-h-[80vh] w-72 shrink-0 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-lg" onKeyDown={event => { if (event.key === "Escape") setSelection(null); }}>
      <div className="mb-3 flex justify-between gap-2"><h3 className="font-semibold">{selected.label} · {selected.isPrimaryStarter ? "主力" : "替补"}</h3><button type="button" aria-label="关闭选手证据" onClick={() => setSelection(null)}>×</button></div><PlayerEvidence member={selected} platform={platform} />
    </aside>}
    </div>
    <Dialog open={Boolean(selected && mobile)} onOpenChange={open => { if (!open) setSelection(null); }}><DialogContent><DialogHeader><DialogTitle>{selected?.label} · 实力证据</DialogTitle><DialogDescription>本届统一段位与来源证据</DialogDescription></DialogHeader><DialogBody>{selected && <PlayerEvidence member={selected} platform={platform} />}</DialogBody></DialogContent></Dialog>
    <Dialog open={moveEntry !== null && editable} onOpenChange={open => { if (!open) setMoveEntry(null); }}><DialogContent><DialogHeader><DialogTitle>移动 {moveEntry ? byId.get(moveEntry)?.teamName : ""}</DialogTitle><DialogDescription>选择目标名次，修改后仍需保存排序。</DialogDescription></DialogHeader><DialogBody>{moveEntry && <MoveControl rank={order.indexOf(moveEntry) + 1} total={order.length} onMove={target => { move(moveEntry, target); setMoveEntry(null); }} />}</DialogBody></DialogContent></Dialog>
  </section>;
}
