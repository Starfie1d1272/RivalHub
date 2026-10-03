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
    <Link
      href={`/${seasonSlug}/matches/${matchId}`}
      data-highlighted={highlighted || undefined}
      className="data-[highlighted=true]:bg-[var(--color-accent-soft)] data-[highlighted=true]:border-l-4 data-[highlighted=true]:border-l-[var(--color-accent)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-panel-hi)] transition-colors duration-150"
    >
      <div className={`flex-1 min-w-0 ${showLiveScore ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:flex sm:gap-3" : "flex items-center gap-3"}`}>
        <span className={`font-semibold truncate min-w-0 flex-1 text-[var(--color-fg)] text-sm sm:text-base ${showLiveScore ? "col-start-1 row-start-1 sm:text-right" : "text-right"}`}>{teamAName}</span>
        <span className={`text-[var(--color-fg-mid)] text-sm shrink-0 ${showLiveScore ? "col-start-2 row-start-1 row-span-2" : ""}`}>
          {status === "finished"
            ? `${scoreA ?? "—"} : ${scoreB ?? "—"}`
            : showLiveScore ? <MatchListLiveScore matchId={matchId} entryAId={entryAId} entryBId={entryBId} context={liveContext} /> : "vs"}
        </span>
        <span className={`font-semibold truncate min-w-0 flex-1 text-[var(--color-fg)] text-sm sm:text-base ${showLiveScore ? "col-start-1 row-start-2" : ""}`}>{teamBName}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
      </div>
    </Link>
  );
}
