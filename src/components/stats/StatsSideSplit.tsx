"use client";
import React from "react";

export interface StatsSideRate {
  rate: number | null;
}

function pct(value: StatsSideRate | null | undefined) {
  return value?.rate === null || value?.rate === undefined ? null : Math.max(0, Math.min(100, value.rate * 100));
}

export function StatsSideSplit({
  ct,
  t,
  compact = false,
}: {
  ct: StatsSideRate | null | undefined;
  t: StatsSideRate | null | undefined;
  compact?: boolean;
}) {
  const ctPct = pct(ct);
  const tPct = pct(t);
  if (ctPct === null || tPct === null) return <span className="text-[var(--color-fg-dim)]">—</span>;

  return (
    <div className={compact ? "min-w-[156px]" : "min-w-[190px] max-w-[240px]"} aria-label={`CT ${ctPct.toFixed(1)}%, T ${tPct.toFixed(1)}%`}>
      <div className="flex items-center justify-between gap-3 text-xs font-medium tabular-nums">
        <span className="text-[var(--color-accent-b)]">CT {ctPct.toFixed(1)}%</span>
        <span className="text-[var(--color-accent)]">{tPct.toFixed(1)}% T</span>
      </div>
      <div className="mt-1.5 flex h-1 overflow-hidden bg-[var(--color-border)]">
        <span className="h-full bg-[var(--color-accent-b)]" style={{ width: `${ctPct}%` }} />
        <span className="h-full bg-[var(--color-accent)]" style={{ width: `${tPct}%` }} />
      </div>
    </div>
  );
}
