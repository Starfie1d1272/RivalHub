import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MatchStatusBadge } from "./MatchStatusBadge";

interface MatchCardProps {
  matchId: string;
  seasonSlug: string;
  teamAName: string;
  teamBName: string;
  scoreA: number | null;
  scoreB: number | null;
  stage: "qualifier" | "playoff";
  format: "bo1" | "bo3" | "bo5";
  status: "scheduled" | "in_progress" | "finished" | "cancelled";
}

const STAGE_LABELS = { qualifier: "排位赛", playoff: "正赛" };
const FORMAT_LABELS = { bo1: "BO1", bo3: "BO3", bo5: "BO5" };

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
}: MatchCardProps) {
  return (
    <Link href={`/${seasonSlug}/matches/${matchId}`}>
      <Card className="p-4 hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="font-semibold truncate text-[var(--text-primary)]">{teamAName}</span>
            <span className="text-[var(--text-secondary)] text-sm shrink-0">
              {status === "finished"
                ? `${scoreA ?? 0} : ${scoreB ?? 0}`
                : "vs"}
            </span>
            <span className="font-semibold truncate text-[var(--text-primary)]">{teamBName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-xs text-[var(--text-secondary)]">
              {STAGE_LABELS[stage]}
            </Badge>
            <Badge variant="outline" className="text-xs text-[var(--text-secondary)]">
              {FORMAT_LABELS[format]}
            </Badge>
            <MatchStatusBadge status={status} />
          </div>
        </div>
      </Card>
    </Link>
  );
}
