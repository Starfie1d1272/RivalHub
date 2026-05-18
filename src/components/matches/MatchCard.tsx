import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { Badge } from "@/components/ui/badge";
import { MatchStatusBadge } from "./MatchStatusBadge";
import { MATCH_FORMAT_LABELS, MATCH_STAGE_LABELS } from "@/types/match";
import { formatCSTShortDate } from "@/lib/utils/date";
import type { MatchFormat } from "@/types/match";

interface MatchCardProps {
  matchId: string;
  seasonSlug: string;
  teamAName: string;
  teamBName: string;
  scoreA: number | null;
  scoreB: number | null;
  stage: string;
  format: MatchFormat;
  status: "scheduled" | "in_progress" | "finished" | "cancelled";
  scheduledAt?: Date | string | null;
}

export function MatchCard({
  matchId,
  seasonSlug,
  teamAName,
  teamBName,
  scoreA,
  scoreB,
  stage,
  format,
  status,
  scheduledAt,
}: MatchCardProps) {
  const timeText =
    status === "scheduled" && scheduledAt
      ? formatCSTShortDate(scheduledAt)
      : status === "scheduled" && !scheduledAt
        ? "未排期"
        : null;

  return (
    <Link href={`/${seasonSlug}/matches/${matchId}`} className="cursor-pointer">
      <Panel hoverable pad={16}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="font-semibold truncate text-[var(--color-fg)] text-sm sm:text-base">{teamAName}</span>
            <span className="text-[var(--color-fg-mid)] text-sm shrink-0">
              {status === "finished"
                ? `${scoreA ?? 0} : ${scoreB ?? 0}`
                : "vs"}
            </span>
            <span className="font-semibold truncate text-[var(--color-fg)] text-sm sm:text-base">{teamBName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {timeText && (
              <span className="text-xs text-[var(--color-fg-mid)]">{timeText}</span>
            )}
            <Badge variant="outline" className="text-xs text-[var(--color-fg-mid)]">
              {MATCH_STAGE_LABELS[stage] ?? stage}
            </Badge>
            <Badge variant="outline" className="text-xs text-[var(--color-fg-mid)]">
              {MATCH_FORMAT_LABELS[format]}
            </Badge>
            <MatchStatusBadge status={status} />
          </div>
        </div>
      </Panel>
    </Link>
  );
}
