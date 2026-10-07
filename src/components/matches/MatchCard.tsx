import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { MatchListLiveScore } from "./MatchListLiveScore";
import type { PublicMatchContext } from "@/lib/matches/public-context";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MatchStatusBadge } from "./MatchStatusBadge";
import { MATCH_FORMAT_LABELS } from "@/types/match";
import { formatCSTDateTime } from "@/lib/utils/date";
import type { MatchFormat } from "@/types/match";

interface MatchCardProps {
  matchId: string;
  entryAId?: string;
  entryBId?: string;
  liveContext?: PublicMatchContext;
  seasonSlug: string;
  teamAName: string;
  teamBName: string;
  scoreA: number | null;
  scoreB: number | null;
  stageLabel: string;
  format: MatchFormat;
  status: "scheduled" | "in_progress" | "finished" | "cancelled";
  scheduledAt?: Date | string | null;
  completedAt?: Date | string | null;
  isForfeit?: boolean;
  highlighted?: boolean;
}

export function MatchCard({
  matchId,
  entryAId, entryBId, liveContext,
  seasonSlug,
  teamAName,
  teamBName,
  scoreA,
  scoreB,
  stageLabel,
  format,
  status,
  scheduledAt,
  completedAt,
  isForfeit = false,
  highlighted = false,
}: MatchCardProps) {
  const showLiveScore = status === "in_progress" && liveContext && entryAId && entryBId;
  const finishedTime = completedAt ?? scheduledAt ?? null;
  const timeText =
    status === "finished"
      ? finishedTime ? formatCSTDateTime(finishedTime) : null
      : status === "scheduled" && scheduledAt
        ? formatCSTDateTime(scheduledAt)
        : status === "scheduled" && !scheduledAt
          ? "未排期"
          : null;

  return (
    <article
      data-highlighted={highlighted || undefined}
      className="data-[highlighted=true]:bg-[var(--color-accent-soft)] data-[highlighted=true]:border-l-4 data-[highlighted=true]:border-l-[var(--color-accent)] flex flex-col lg:flex-row lg:items-center lg:justify-between lg:h-16 lg:py-0 gap-2 px-4 py-3 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-panel-hi)] transition-colors duration-150"
    >
      <div className={`flex-1 min-w-0 ${showLiveScore ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 lg:grid lg:grid-cols-[minmax(0,1fr)_11rem_minmax(0,1fr)] lg:gap-3" : "grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] items-center gap-3 lg:grid-cols-[minmax(0,1fr)_11rem_minmax(0,1fr)]"}`}>
        <span className={`font-semibold truncate min-w-0 flex-1 text-[var(--color-fg)] text-sm sm:text-base ${showLiveScore ? "col-start-1 row-start-1 lg:text-right" : "text-right"}`}><TeamProfileLink entryId={entryAId} seasonSlug={seasonSlug}>{teamAName}</TeamProfileLink></span>
        <Link href={`/${seasonSlug}/matches/${matchId}`} aria-label={`查看 ${teamAName} 对 ${teamBName} 比赛`} className={`text-center font-mono tabular-nums text-[var(--color-fg-mid)] text-sm shrink-0 ${showLiveScore ? "col-start-2 row-start-1 row-span-2 lg:row-span-1" : ""}`}>
          {status === "finished"
            ? `${scoreA ?? "—"} : ${scoreB ?? "—"}`
            : showLiveScore ? <MatchListLiveScore matchId={matchId} entryAId={entryAId} entryBId={entryBId} context={liveContext} /> : "vs"}
        </Link>
        <span className={`font-semibold truncate min-w-0 flex-1 text-[var(--color-fg)] text-sm sm:text-base ${showLiveScore ? "col-start-1 row-start-2 lg:col-start-3 lg:row-start-1" : ""}`}><TeamProfileLink entryId={entryBId} seasonSlug={seasonSlug}>{teamBName}</TeamProfileLink></span>
      </div>
      <Link href={`/${seasonSlug}/matches/${matchId}`} className="flex items-center gap-2 shrink-0 flex-wrap lg:w-64 lg:justify-end">
        {timeText && (
          <span className="text-xs text-[var(--color-fg-mid)]">{timeText}</span>
        )}
        <Badge variant="outline" className="text-xs text-[var(--color-fg-mid)]">
          {stageLabel}
        </Badge>
        <Badge variant="outline" className="text-xs text-[var(--color-fg-mid)]">
          {MATCH_FORMAT_LABELS[format]}
        </Badge>
        <MatchStatusBadge status={status} isForfeit={isForfeit} scheduledAt={scheduledAt} />
      </Link>
    </article>
  );
}
