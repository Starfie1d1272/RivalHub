import { presentSeasonStatus } from "@/lib/seasons/presentation";
import type { SeasonStatus } from "@/types/season";

const TONE_COLOR = {
  neutral: "bg-[var(--color-fg-dim)]",
  info: "bg-[var(--color-info)]",
  success: "bg-[var(--color-ok)]",
  warn: "bg-[var(--color-warn)]",
  danger: "bg-[var(--color-danger)]",
  accent: "bg-[var(--color-accent)]",
} as const;

export function StatusDot({ status }: { status: SeasonStatus }) {
  const tone = presentSeasonStatus(status).tone;
  return (
    <span className="relative flex h-2 w-2">
      {(tone === "info" || tone === "success" || tone === "danger" || tone === "accent") && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${TONE_COLOR[tone]} opacity-60`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${TONE_COLOR[tone]}`} />
    </span>
  );
}
