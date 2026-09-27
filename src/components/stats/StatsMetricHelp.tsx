"use client";
import React, { type ReactNode } from "react";

import { StatsTooltip } from "@/components/stats/StatsTooltip";
import { STATS_METRICS, type StatsMetricKey } from "@/lib/stats/metrics";

export function StatsMetricHelp({ metric }: { metric: StatsMetricKey }) {
  const definition = STATS_METRICS[metric];
  if (!definition.description) return null;
  return <StatsTooltip label={`${definition.label} 指标说明`} content={definition.description} />;
}

export function StatsMetricLabel({ metric, children }: { metric: StatsMetricKey; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="min-w-0">{children}</span>
      <StatsMetricHelp metric={metric} />
    </span>
  );
}
