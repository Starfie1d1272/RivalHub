type Tone = "info" | "success" | "warn" | "error" | "live";

const TONE_CONFIG: Record<Tone, { color: string; glyph: string }> = {
  info:    { color: "var(--color-accent)", glyph: "●" },
  success: { color: "var(--color-ok)", glyph: "✓" },
  warn:    { color: "var(--color-warn)", glyph: "▲" },
  error:   { color: "var(--color-danger)", glyph: "✕" },
  live:    { color: "var(--color-danger)", glyph: "●" },
};

interface StatusBannerProps {
  tone?: Tone;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  onDismiss?: () => void;
}

export function StatusBanner({
  tone = "info",
  title,
  sub,
  action,
  onDismiss,
}: StatusBannerProps) {
  const c = TONE_CONFIG[tone].color;
  return (
    <div
      className="grid gap-3.5 items-center rounded-sm border px-4 py-2.5"
      style={{
        gridTemplateColumns: "auto 1fr auto auto",
        background: `color-mix(in srgb, ${c} 6%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 33%, transparent)`,
        borderLeft: `3px solid ${c}`,
      }}
    >
      <div
        className="flex items-center justify-center font-bold rounded-sm"
        style={{
          width: 22,
          height: 22,
          color: c,
          borderColor: `color-mix(in srgb, ${c} 33%, transparent)`,
          border: `1px solid color-mix(in srgb, ${c} 33%, transparent)`,
          background: `color-mix(in srgb, ${c} 12%, transparent)`,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
        }}
      >
        {TONE_CONFIG[tone].glyph}
      </div>
      <div className="min-w-0">
        <div
          className="font-semibold"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--color-fg)",
          }}
        >
          {title}
        </div>
        {sub && (
          <div
            className="mt-0.5"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-mid)",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {action && <div>{action}</div>}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="px-1"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-fg-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
