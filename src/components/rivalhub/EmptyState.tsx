interface EmptyStateProps {
  icon?: string;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  accent?: boolean;
}

export function EmptyState({
  icon = "◇",
  title,
  sub,
  action,
  accent,
}: EmptyStateProps) {
  return (
    <div className="py-12 px-6 text-center">
      <div
        className="mx-auto mb-3.5 grid place-items-center"
        style={{
          width: 56,
          height: 56,
          borderColor: accent
            ? "color-mix(in srgb, var(--color-accent) 33%, transparent)"
            : "var(--color-border)",
          border: `1px solid ${accent ? "color-mix(in srgb, var(--color-accent) 33%, transparent)" : "var(--color-border)"}`,
          background: accent
            ? "color-mix(in srgb, var(--color-accent) 6%, transparent)"
            : "var(--color-panel-low)",
          color: accent ? "var(--color-accent)" : "var(--color-fg-dim)",
          borderRadius: "var(--radius-md)",
          fontSize: 22,
        }}
      >
        {icon}
      </div>
      <div
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color: "var(--color-fg)",
          letterSpacing: "var(--tracking-tight-1)",
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          className="mt-2 mx-auto max-w-[380px] leading-relaxed"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-fg-mid)",
            letterSpacing: "var(--tracking-ticker)",
          }}
        >
          {sub}
        </div>
      )}
      {action && <div className="mt-4.5">{action}</div>}
    </div>
  );
}
