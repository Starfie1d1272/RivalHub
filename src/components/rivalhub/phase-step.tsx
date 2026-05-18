interface PhaseStepProps {
  label: string;
  stepNumber: number;
  isDone: boolean;
  isCurrent: boolean;
  isLast: boolean;
}

export function PhaseStep({ label, stepNumber, isDone, isCurrent, isLast }: PhaseStepProps) {
  const iconBorderColor = isDone
    ? "var(--color-ok)"
    : isCurrent
      ? "var(--color-accent)"
      : "var(--color-border)";

  const iconBg = isDone
    ? "rgba(77,212,122,0.13)"
    : isCurrent
      ? "rgba(255,107,26,0.13)"
      : "transparent";

  const iconColor = isDone
    ? "var(--color-ok)"
    : isCurrent
      ? "var(--color-accent)"
      : "var(--color-fg-dim)";

  const iconShadow = isCurrent ? "0 0 12px rgba(255,107,26,0.2)" : undefined;

  const labelColor = isDone
    ? "var(--color-fg)"
    : isCurrent
      ? "var(--color-accent)"
      : "var(--color-fg-mid)";

  return (
    <div
      className="relative flex-1 min-w-[120px]"
      style={{
        padding: "18px 16px",
        borderRight: !isLast ? "1px solid var(--color-border)" : "none",
        background: isCurrent ? "var(--color-panel-hi)" : "transparent",
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        {/* Icon dot */}
        <div
          className="grid place-items-center font-bold rounded-sm shrink-0"
          style={{
            width: 16,
            height: 16,
            border: `1px solid ${iconBorderColor}`,
            background: iconBg,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: iconColor,
            boxShadow: iconShadow,
          }}
        >
          {isDone ? "✓" : stepNumber}
        </div>

        {/* Connector line between icon and label */}
        <div
          className="uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-fg-dim)",
            letterSpacing: "var(--tracking-label)",
          }}
        >
          STEP {stepNumber}
        </div>
      </div>

      {/* Step label */}
      <div
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 14,
          color: labelColor,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>

      {/* Connector line to next step (bottom-right area, purely decorative) */}
      {!isLast && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "50%",
            right: -1,
            transform: "translateY(-50%)",
            width: 1,
            height: "40%",
            background: isDone
              ? "rgba(77,212,122,0.4)"
              : "var(--color-border)",
          }}
        />
      )}
    </div>
  );
}
