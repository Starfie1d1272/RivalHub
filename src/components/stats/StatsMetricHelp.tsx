"use client";
import React, { useId } from "react";

import { STATS_METRICS, type StatsMetricKey } from "@/lib/stats/metrics";

export function StatsMetricHelp({ metric }: { metric: StatsMetricKey }) {
  const id = useId();
  const definition = STATS_METRICS[metric];
  if (!definition.description) return null;

  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`${definition.label} 指标说明`}
        aria-describedby={id}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium text-[var(--color-fg-dim)] transition-colors hover:text-[var(--color-fg)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-accent)]"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-64 border border-[var(--color-border-hi)] bg-[var(--color-panel-hi)] px-3 py-2 text-left text-xs font-normal normal-case leading-5 tracking-normal text-[var(--color-fg)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {definition.description}
      </span>
    </span>
  );
}
