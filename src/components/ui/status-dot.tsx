import { SEASON_STATUS_TONE } from "@/types/season";
import type { SeasonStatus } from "@/types/season";

const TONE_COLOR = {
  live: "bg-[var(--color-ok)]",
  soon: "bg-[var(--color-warn)]",
  done: "bg-[var(--color-fg-dim)]",
} as const;

export function StatusDot({ status }: { status: SeasonStatus }) {
  const tone = SEASON_STATUS_TONE[status];
  return (
    <span className="relative flex h-2 w-2">
      {tone === "live" && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${TONE_COLOR[tone]} opacity-60`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${TONE_COLOR[tone]}`} />
    </span>
  );
}
