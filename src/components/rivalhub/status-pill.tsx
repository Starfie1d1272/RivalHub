const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  live:      { color: "#ff5470", label: "● LIVE" },
  finished:  { color: "#525a6a", label: "FT" },
  scheduled: { color: "#8e96a3", label: "UPCOMING" },
  open:      { color: "#4dd47a", label: "● OPEN" },
  voting:    { color: "#ffc44d", label: "● VOTING" },
  drafting:  { color: "#ff6b1a", label: "● DRAFTING" },
  playing:   { color: "#4dd47a", label: "● PLAYING" },
};

interface StatusPillProps {
  status: string;
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
        borderColor: cfg.color + "55",
        background: cfg.color + "12",
      }}
    >
      {cfg.label}
    </span>
  );
}
