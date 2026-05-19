import type { SeasonStatus } from "@/types/season";

const STATUS_CONFIG: Record<SeasonStatus | string, { color: string; label: string }> = {
  draft:        { color: "var(--color-fg-dim)", label: "DRAFT" },
  archived:     { color: "var(--color-fg-dim)", label: "ARCHIVED" },
  live:         { color: "var(--color-danger)", label: "● LIVE" },
  finished:     { color: "var(--color-fg-dim)", label: "FT" },
  scheduled:    { color: "var(--color-fg-mid)", label: "UPCOMING" },
  open:         { color: "var(--color-ok)", label: "● OPEN" },
  registration: { color: "var(--color-ok)", label: "● OPEN" },
  voting:       { color: "var(--color-warn)", label: "● VOTING" },
  drafting:     { color: "var(--color-accent)", label: "● DRAFTING" },
  playing:      { color: "var(--color-ok)", label: "● PLAYING" },
};

interface StatusPillProps {
  status: SeasonStatus | string;
}

export function StatusPill({ status }: StatusPillProps) {
  const cfg = STATUS_CONFIG[status] ?? {
    color: "var(--color-fg-mid)",
    label: status,
  };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 font-bold rounded-sm border"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "var(--tracking-label)",
        color: cfg.color,
        borderColor: `color-mix(in srgb, ${cfg.color} 33%, transparent)`,
        background: `color-mix(in srgb, ${cfg.color} 7%, transparent)`,
      }}
    >
      {cfg.label}
    </span>
  );
}
