import React, { type ReactNode } from "react";
import Link from "next/link";

type ChecklistState = "complete" | "blocked" | "pending" | "manual";

export interface ChecklistItem {
  label: string;
  detail?: string;
  state: ChecklistState;
  href?: string;
  action?: ReactNode;
}

const STATE: Record<ChecklistState, { glyph: string; color: string; label: string }> = {
  complete: { glyph: "✓", color: "var(--color-ok)", label: "已完成" },
  blocked: { glyph: "×", color: "var(--color-danger)", label: "受阻" },
  pending: { glyph: "·", color: "var(--color-warn)", label: "待完成" },
  manual: { glyph: "○", color: "var(--color-accent)", label: "人工确认" },
};

/** Compact, scan-friendly status rows for readiness and operator checks. */
export function Checklist({ items, className = "" }: { items: ChecklistItem[]; className?: string }) {
  return (
    <ul className={`divide-y divide-[var(--color-border)] border border-[var(--color-border)] ${className}`}>
      {items.map((item) => {
        const state = STATE[item.state];
        const content = (
          <>
            <span
              aria-label={state.label}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border font-mono text-xs"
              style={{ color: state.color, borderColor: `color-mix(in srgb, ${state.color} 45%, var(--color-border))` }}
            >
              {state.glyph}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--color-fg)]">{item.label}</span>
              {item.detail && <span className="mt-0.5 block break-words font-sans text-sm leading-6 text-[var(--color-fg-secondary)]">{item.detail}</span>}
            </span>
          </>
        );
        const classes = "flex min-w-0 gap-3 px-3 py-2.5 transition-colors";
        if (!item.action) {
          return <li key={`${item.label}-${item.detail ?? ""}`}>
            {item.href ? <Link href={item.href as never} className={`${classes} hover:bg-[var(--color-panel-hi)]`}>{content}</Link> : <div className={classes}>{content}</div>}
          </li>;
        }

        return <li key={`${item.label}-${item.detail ?? ""}`}>
          <div className={`${classes} items-start justify-between`}>
            {item.href ? <Link href={item.href as never} className="flex min-w-0 flex-1 gap-3 hover:bg-[var(--color-panel-hi)]">{content}</Link> : <div className="flex min-w-0 flex-1 gap-3">{content}</div>}
            {item.action}
          </div>
        </li>;
      })}
    </ul>
  );
}
