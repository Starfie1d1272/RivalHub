type Tone = "info" | "success" | "warn" | "error" | "live";

const TONE_CONFIG: Record<Tone, { color: string; glyph: string }> = {
  info:    { color: "#ff6b1a", glyph: "●" },
  success: { color: "#4dd47a", glyph: "✓" },
  warn:    { color: "#ffc44d", glyph: "▲" },
  error:   { color: "#ff5470", glyph: "✕" },
  live:    { color: "#ff5470", glyph: "●" },
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
  const config = TONE_CONFIG[tone];
  return (
    <div
      className="grid gap-3.5 items-center rounded-sm border px-4 py-2.5"
      style={{
        gridTemplateColumns: "auto 1fr auto auto",
        background: config.color + "10",
        borderColor: config.color + "55",
        borderLeft: `3px solid ${config.color}`,
      }}
    >
      <div
        className="flex items-center justify-center font-bold rounded-sm"
        style={{
          width: 22,
          height: 22,
          color: config.color,
          borderColor: config.color + "55",
          border: `1px solid ${config.color}55`,
          background: config.color + "1f",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
        }}
      >
        {config.glyph}
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
