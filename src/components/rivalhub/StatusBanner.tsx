import React from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "info" | "success" | "warn" | "error" | "live";

const TONE_CONFIG: Record<Tone, { color: string; glyph: string }> = {
  info: { color: "var(--color-info)", glyph: "●" },
  success: { color: "var(--color-ok)", glyph: "✓" },
  warn: { color: "var(--color-warn)", glyph: "▲" },
  error: { color: "var(--color-danger)", glyph: "✕" },
  live: { color: "var(--color-danger)", glyph: "●" },
};

interface StatusBannerProps {
  tone?: Tone;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  onDismiss?: () => void;
}

export function StatusBanner({ tone = "info", title, sub, action, onDismiss }: StatusBannerProps) {
  const c = TONE_CONFIG[tone].color;
  return (
    <div
      className={cn(
        "relative flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-sm border px-4 py-2.5",
        onDismiss && "pr-12",
      )}
      style={{
        background: `color-mix(in srgb, ${c} 6%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 33%, transparent)`,
        borderLeft: `3px solid ${c}`,
      }}
    >
      <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3.5">
        <div
          aria-hidden="true"
          className="flex shrink-0 items-center justify-center rounded-sm font-bold"
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
        <div className="min-w-0 break-words">
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
            <p className="mt-1 font-sans text-sm leading-6 text-[var(--color-fg-secondary)]">
              {sub}
            </p>
          )}
        </div>
      </div>
      {action && <div className="ml-9 min-w-0 max-w-full">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭"
          className="absolute top-2.5 right-3 inline-grid size-6 place-items-center rounded-sm"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-fg-secondary)",
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
