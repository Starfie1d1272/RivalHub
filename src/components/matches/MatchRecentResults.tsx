import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import type { RecentMatchResult } from "@/lib/matches/recent-results";

function TeamResults({ name, matches, seasonSlug }: { name: string; matches: RecentMatchResult[]; seasonSlug: string }) {
  return <div className="min-w-0">
    <h3 className="mb-2 truncate text-sm font-semibold">{name}</h3>
    {matches.length === 0
      ? <p className="text-xs text-[var(--color-fg-mid)]">暂无近期赛果</p>
      : <ul className="space-y-1.5">
        {matches.map(match => <li key={match.matchId}>
          <Link href={`/${seasonSlug}/matches/${match.matchId}`} className="grid min-h-10 grid-cols-[2.5rem_4rem_minmax(0,1fr)_auto] items-center gap-2 rounded border border-[var(--color-border)] px-2 text-xs hover:border-[var(--color-border-hover)]">
            <span className={match.won ? "font-bold text-[var(--color-success)]" : "font-bold text-[var(--color-danger)]"}>{match.won ? "胜" : "负"}</span>
            <span className="text-[var(--color-fg-mid)]">{match.format.toUpperCase()}<span className="block text-[10px]">{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" }).format(match.playedAt)}</span></span>
            <span className="min-w-0 truncate">{match.opponentName}</span>
            <span className="font-mono tabular-nums">{match.scoreFor} : {match.scoreAgainst}</span>
          </Link>
        </li>)}
      </ul>}
  </div>;
}

export function MatchRecentResults({ teamAName, teamBName, teamA, teamB, seasonSlug }: {
  teamAName: string;
  teamBName: string;
  teamA: RecentMatchResult[];
  teamB: RecentMatchResult[];
  seasonSlug: string;
}) {
  return <Panel label="本赛季近期赛果" contentClassName="grid gap-5 p-4 sm:grid-cols-2">
    <TeamResults name={teamAName} matches={teamA} seasonSlug={seasonSlug} />
    <TeamResults name={teamBName} matches={teamB} seasonSlug={seasonSlug} />
  </Panel>;
}
