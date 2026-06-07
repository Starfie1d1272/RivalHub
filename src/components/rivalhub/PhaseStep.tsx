interface PhaseStepProps {
  label: string;
  stepNumber: number;
  isDone: boolean;
  isCurrent: boolean;
  isLast: boolean;
}

export function PhaseStep({ label, stepNumber, isDone, isCurrent, isLast }: PhaseStepProps) {
  const color = isDone
    ? "var(--color-ok)"
    : isCurrent
      ? "var(--color-accent)"
      : "var(--color-fg-dim)";

  const iconBg = isDone
    ? "rgba(77,212,122,0.13)"
    : isCurrent
      ? "rgba(255,107,26,0.09)"
      : "transparent";

  return (
    <div
      className="flex items-center gap-0"
      style={{ flex: isLast ? "0 0 auto" : 1 }}
    >
      <div className="flex flex-col items-center gap-1 min-w-[80px]">
        <div
          className="grid place-items-center font-bold shrink-0"
          style={{
            width: 24,
            height: 24,
            border: `2px solid ${color}`,
            background: iconBg,
            borderRadius: "var(--radius-sm, 2px)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            color,
            boxShadow: isCurrent ? `0 0 12px ${color}33` : "none",
            transition: "all 300ms ease",
          }}
        >
          {isDone ? "✓" : stepNumber}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 700,
            color,
            letterSpacing: "0.06em",
            textAlign: "center",
          }}
        >
          {label}
        </div>
      </div>
      {!isLast && (
        <div
          aria-hidden
          style={{
            flex: 1,
            height: 2,
            margin: "0 8px",
            marginTop: -18,
            background: isDone ? "rgba(77,212,122,0.35)" : "var(--color-border)",
            transition: "background 300ms ease",
          }}
        />
      )}
    </div>
  );
}
