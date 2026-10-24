import { HONOR_STATE_LABELS } from "@/lib/postevent/presentation";
import { PublicAdjudications } from "./PublicAdjudications";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import React from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import type { PublicSeasonResults, PublicSeasonResultSummary } from "@/lib/seasons/public-results";
type Props = { slug: string; embedded?: boolean } & (
  { compact: true; results: PublicSeasonResultSummary } | { compact?: false; results: PublicSeasonResults }
);
export function SeasonResults({ results, slug, compact = false, embedded = false }: Props) {
  const full = "placements" in results ? results : null;
  const content = <>
    {results.champion ? <div><p className="text-xs text-[var(--color-fg-mid)]">冠军</p><TeamProfileLink className="text-2xl font-bold text-[var(--color-accent)]" seasonSlug={slug} entryId={results.champion.entryId}>{results.champion.name}</TeamProfileLink></div> : <p className="text-sm text-[var(--color-fg-mid)]">{results.championVacant ? "冠军空缺" : "冠军尚未公布"}</p>}
    {results.final && <Link className="block text-sm" href={`/${slug}/matches/${results.final.id}`}>决赛 · {results.final.teamA} {results.final.scoreA ?? "—"} : {results.final.scoreB ?? "—"} {results.final.teamB} →</Link>}
    {!compact && full && full.placements.length > 0 && <details><summary className="cursor-pointer font-semibold">最终排名</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{full.placements.map((entry) => <TeamProfileLink key={entry.entryId} seasonSlug={slug} entryId={entry.entryId} className="flex justify-between gap-3 text-sm"><span>{entry.name}</span><span>{entry.label}</span></TeamProfileLink>)}</div></details>}
    {!compact && full && full.honors.length > 0 && <div className="flex flex-wrap gap-3">{full.honors.map((honor) => <Link key={honor.id} className="text-sm" href={honor.entryId ? `/${slug}/teams/${honor.entryId}` : `/players/${honor.userId}`}>{honor.label} · {honor.name}</Link>)}</div>}
    {!compact && full && full.honorHistory?.length > 0 && <details className="border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-fg-mid)]"><summary className="cursor-pointer">荣誉变更记录</summary><div className="mt-3 divide-y divide-[var(--color-border)]">{full.honorHistory.map((honor) => <div key={honor.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{honor.label}{honor.name ? ` · ${honor.name}` : ""}</span><span>{HONOR_STATE_LABELS[honor.state]}</span></div>)}</div></details>}
    {!compact && full && <PublicAdjudications adjudications={full.adjudications} seasonSlug={slug} />}
  </>;
  return embedded ? <div className="space-y-4 border-t border-[var(--color-border)] pt-4">{content}</div> : <Panel label="赛事结果" contentClassName="space-y-4 p-5">{content}</Panel>;
}
