import { CopyMatchLink } from "./CopyMatchLink";
import Link from "next/link";
import { presentMatchStatus } from "@/lib/matches/presentation";
import { MATCH_FORMAT_LABELS } from "@/types/match";

export function TestMatchList({ matches, admin = false }: { matches: { id: string; seasonSlug: string; teamAName: string; teamBName: string; status: "scheduled" | "in_progress" | "finished" | "cancelled"; format: "bo1" | "bo3" | "bo5"; scheduledAt: Date | null }[]; admin?: boolean }) {
  if (!matches.length) return <p className="text-sm text-[var(--color-fg-mid)]">暂无测试赛。</p>;
  return <ul className="divide-y divide-[var(--color-border)]">{matches.map(match => <li key={match.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
    <div className="min-w-0"><Link className="break-words text-[var(--color-accent)] hover:underline" href={`/${match.seasonSlug}/matches/${match.id}`}>{match.teamAName} vs {match.teamBName}</Link><p className="text-xs text-[var(--color-fg-mid)]">{MATCH_FORMAT_LABELS[match.format]} · {presentMatchStatus(match.status, match).label}</p></div>
    <div className="flex flex-wrap items-center gap-3"><CopyMatchLink href={`/${match.seasonSlug}/matches/${match.id}`} />{admin && <Link className="text-sm text-[var(--color-accent)] hover:underline" href={`/admin/${match.seasonSlug}/matches/${match.id}`}>比赛工作台</Link>}</div>
  </li>)}</ul>;
}
