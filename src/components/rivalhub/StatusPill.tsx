import type { SemanticTone } from "@/lib/presentation";

const TONE_COLOR: Record<SemanticTone, string> = {
  neutral: "var(--color-fg-mid)",
  info: "var(--color-info)",
  success: "var(--color-ok)",
  warn: "var(--color-warn)",
  danger: "var(--color-danger)",
  accent: "var(--color-accent)",
};

interface StatusPillProps {
  label: string;
  tone: SemanticTone;
}

export function StatusPill({ label, tone }: StatusPillProps) {
  const color = TONE_COLOR[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 font-bold rounded-sm border"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "var(--tracking-label)",
        color,
        borderColor: `color-mix(in srgb, ${color} 33%, transparent)`,
        background: `color-mix(in srgb, ${color} 7%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}
