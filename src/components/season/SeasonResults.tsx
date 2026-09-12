import React from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import type { PublicSeasonResults } from "@/lib/seasons/public-results";
export function SeasonResults({ results, slug, compact = false, embedded = false }: { results: PublicSeasonResults; slug: string; compact?: boolean; embedded?: boolean }) {
  const content = <>
    {results.champion ? <div><p className="text-xs text-[var(--color-fg-mid)]">冠军</p><Link className="text-2xl font-bold text-[var(--color-accent)]" href={`/${slug}/teams/${results.champion.entryId}`}>{results.champion.name}</Link></div> : <p className="text-sm text-[var(--color-fg-mid)]">冠军尚未公布</p>}
    {results.final && <Link className="block text-sm" href={`/${slug}/matches/${results.final.id}`}>决赛 · {results.final.teamA} {results.final.scoreA ?? "—"} : {results.final.scoreB ?? "—"} {results.final.teamB} →</Link>}
    {!compact && results.placements.length > 0 && <details><summary className="cursor-pointer font-semibold">最终排名</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{results.placements.map((entry) => <Link key={entry.entryId} href={`/${slug}/teams/${entry.entryId}`} className="flex justify-between gap-3 text-sm"><span>{entry.name}</span><span>{entry.label}</span></Link>)}</div></details>}
    {!compact && results.honors.length > 0 && <div className="flex flex-wrap gap-3">{results.honors.map((honor) => <Link key={honor.id} className="text-sm" href={honor.entryId ? `/${slug}/teams/${honor.entryId}` : `/players/${honor.userId}`}>{honor.label} · {honor.name}</Link>)}</div>}
  </>;
  return embedded ? <div className="space-y-4 border-t border-[var(--color-border)] pt-4">{content}</div> : <Panel label="赛事结果" contentClassName="space-y-4 p-5">{content}</Panel>;
}
