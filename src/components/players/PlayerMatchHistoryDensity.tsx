"use client";

import { useState, type ReactNode } from "react";

const densities = [
  { value: "compact", label: "紧凑", rows: 5, className: "[&_tbody_td]:py-1" },
  { value: "standard", label: "标准", rows: 4, className: "[&_tbody_td]:py-2" },
  { value: "comfortable", label: "宽松", rows: 3, className: "[&_tbody_td]:py-3" },
] as const;

export function PlayerMatchHistoryDensity({ children, summary, pagination }: {
  children: ReactNode;
  summary?: ReactNode;
  pagination?: ReactNode;
}) {
  const [density, setDensity] = useState<(typeof densities)[number]>(densities[0]);
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {summary}
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {pagination}
        <div role="group" aria-label="比赛列表密度" className="flex items-center gap-1">
          {densities.map((option) => <button key={option.value} type="button"
            aria-label={`${option.label}排列`} title={`${option.label}排列`} aria-pressed={density.value === option.value}
            onClick={() => setDensity(option)}
            className="inline-flex size-8 items-center justify-center rounded-sm text-[var(--color-fg-dim)] hover:bg-[var(--color-panel-hi)] hover:text-[var(--color-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] aria-pressed:bg-[var(--color-panel-hi)] aria-pressed:text-[var(--color-accent)]">
            <span aria-hidden="true" className="flex h-4 w-4 flex-col justify-between">
              {Array.from({ length: option.rows }, (_, row) => <span key={row} className="h-0.5 w-full bg-current" />)}
            </span>
          </button>)}
        </div>
      </div>
    </div>
    <div className={`max-w-full overflow-x-auto rounded-sm border border-[var(--color-border)] ${density.className}`}>
      {children}
    </div>
  </div>;
}
