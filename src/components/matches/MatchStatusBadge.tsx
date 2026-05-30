import { Badge } from "@/components/ui/badge";
import { MATCH_STATUS_LABELS } from "@/types/match";
import type { MatchStatus } from "@/types/match";

const STATUS_STYLES: Record<MatchStatus, string> = {
  scheduled:   "border-[var(--color-border)] text-[var(--color-fg-dim)] bg-transparent",
  in_progress: "border-[var(--color-info-edge)] text-[var(--color-info)] bg-[var(--color-info-soft)]",
  finished:    "border-[color-mix(in srgb, var(--color-ok) 30%, transparent)] text-[var(--color-ok)] bg-[color-mix(in srgb, var(--color-ok) 10%, transparent)]",
  cancelled:   "border-[color-mix(in srgb, var(--color-danger) 30%, transparent)] text-[var(--color-danger)] bg-[color-mix(in srgb, var(--color-danger) 8%, transparent)]",
};

export function MatchStatusBadge({
  status,
  isForfeit = false,
  scheduledAt,
}: {
  status: MatchStatus;
  isForfeit?: boolean;
  scheduledAt?: Date | string | null;
}) {
  let label = isForfeit && status === "finished" ? "弃赛" : MATCH_STATUS_LABELS[status];
  if (status === "scheduled") label = scheduledAt ? "待进行" : "待排期";
  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      {label}
    </Badge>
  );
}
