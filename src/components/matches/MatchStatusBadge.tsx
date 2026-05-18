import { Badge } from "@/components/ui/badge";
import { MATCH_STATUS_LABELS } from "@/types/match";
import type { MatchStatus } from "@/types/match";

const STATUS_STYLES: Record<MatchStatus, string> = {
  scheduled:   "border-[var(--color-border)] text-[var(--color-fg-dim)] bg-transparent",
  in_progress: "border-[var(--color-info-edge)] text-[var(--color-info)] bg-[var(--color-info-soft)]",
  finished:    "border-[rgba(77,212,122,0.3)] text-[var(--color-ok)] bg-[rgba(77,212,122,0.1)]",
  cancelled:   "border-[rgba(255,84,112,0.3)] text-[var(--color-danger)] bg-[rgba(255,84,112,0.08)]",
};

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      {MATCH_STATUS_LABELS[status]}
    </Badge>
  );
}
