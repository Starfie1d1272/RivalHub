import { Badge } from "@/components/ui/badge";
import { presentMatchStatus } from "@/lib/matches/presentation";
import type { SemanticTone } from "@/lib/presentation";
import type { MatchStatus } from "@/types/match";

const TONE_STYLES: Record<SemanticTone, string> = {
  neutral: "border-[var(--color-border)] text-[var(--color-fg-dim)] bg-transparent",
  info: "border-[var(--color-info-edge)] text-[var(--color-info)] bg-[var(--color-info-soft)]",
  success: "border-[var(--color-ok-edge)] text-[var(--color-ok)] bg-[var(--color-ok-soft)]",
  warn: "border-[var(--color-warn-edge)] text-[var(--color-warn)] bg-[var(--color-warn-soft)]",
  danger: "border-[var(--color-danger-edge)] text-[var(--color-danger)] bg-[var(--color-danger-soft)]",
  accent: "border-[var(--color-accent-edge)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]",
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
  const presentation = presentMatchStatus(status, { isForfeit, scheduledAt });
  return (
    <Badge variant="outline" className={TONE_STYLES[presentation.tone]}>
      {presentation.label}
    </Badge>
  );
}
