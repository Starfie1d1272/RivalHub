import Link from "next/link";
import type { PublicEventTeamMatch } from "@/lib/competition-entries/public-team-context";
import { presentMatchStatus } from "@/lib/matches/presentation";

type TeamMatch = PublicEventTeamMatch & { seasonSlug: string; seasonName?: string };

export function TeamMatches({ matches }: { matches: readonly TeamMatch[] }) {
  const ordered = matches.toSorted((a, b) => {
    const aFinished = a.status === "finished" || a.status === "cancelled";
    const bFinished = b.status === "finished" || b.status === "cancelled";
    if (aFinished !== bFinished) return aFinished ? 1 : -1;
    const timeA = (a.completedAt ?? a.scheduledAt)?.getTime() ?? 0;
    const timeB = (b.completedAt ?? b.scheduledAt)?.getTime() ?? 0;
    return aFinished ? timeB - timeA : timeA - timeB;
  });
  return <section className="min-w-0 space-y-4">
    <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">MATCHES</p><h2 className="mt-1 text-lg font-semibold">近期比赛</h2></div>
    <div className="border-y border-[var(--color-border)] divide-y divide-[var(--color-border)]">
      {ordered.length ? ordered.slice(0, 5).map(match => <TeamMatchRow key={match.id} match={match} />) : <p className="py-4 text-sm text-[var(--color-fg-mid)]">暂无比赛。</p>}
    </div>
    {ordered.length > 5 && <details className="border-t border-[var(--color-border)] pt-3">
      <summary className="cursor-pointer text-sm text-[var(--color-fg-mid)]">其余比赛 · {ordered.length - 5} 场</summary>
      <div className="mt-3 divide-y divide-[var(--color-border)]">{ordered.slice(5).map(match => <TeamMatchRow key={match.id} match={match} />)}</div>
    </details>}
  </section>;
}

function TeamMatchRow({ match }: { match: TeamMatch }) {
  const status = presentMatchStatus(match.status, { isForfeit: match.isForfeit, scheduledAt: match.scheduledAt }).label;
  const score = match.displayScore ?? { own: match.ownScore, opponent: match.opponentScore };
  const hasScore = score.own !== null && score.opponent !== null;
  return <Link href={`/${match.seasonSlug}/matches/${match.id}`} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 px-1 py-3 text-sm hover:bg-[var(--color-panel-hi)]">
    <span className="min-w-0 break-words font-medium">对阵 {match.opponentName ?? "待定"}{match.seasonName && <span className="mt-1 block text-xs font-normal text-[var(--color-fg-mid)]">{match.seasonName}</span>}</span>
    <span className="flex w-[5.5rem] shrink-0 flex-col items-end text-right tabular-nums">
      {hasScore && <span className="text-base font-semibold">{score.own} : {score.opponent}</span>}
      <span className={`${hasScore ? "mt-0.5" : ""} text-xs font-normal text-[var(--color-fg-mid)]`}>{status}</span>
    </span>
  </Link>;
}
