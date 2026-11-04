"use client";
import React, { type ReactNode } from "react";

import { StatsTooltip } from "@/components/stats/StatsTooltip";
import { STATS_METRICS, type StatsMetricKey } from "@/lib/stats/metrics";

export function StatsMetricHelp({ metric }: { metric: StatsMetricKey }) {
  const definition = STATS_METRICS[metric];
  if (!definition.description) return null;
  return <StatsTooltip label={`${definition.label} 指标说明`} content={definition.description} />;
}

export function StatsHelpLabel({ children, help }: { children: ReactNode; help: ReactNode }) {
  return (
    <span className="relative inline-flex max-w-full items-center">
      <span className="min-w-0">{children}</span>
      <span className="absolute left-full top-1/2 ml-1 -translate-y-1/2">{help}</span>
    </span>
  );
}

export function StatsMetricLabel({ metric, children }: { metric: StatsMetricKey; children: ReactNode }) {
  return <StatsHelpLabel help={<StatsMetricHelp metric={metric} />}>{children}</StatsHelpLabel>;
}
