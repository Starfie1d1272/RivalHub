"use client";
import React from "react";

import { StatsTooltip } from "@/components/stats/StatsTooltip";
import { STATS_METRICS, type StatsMetricKey } from "@/lib/stats/metrics";

export function StatsMetricHelp({ metric }: { metric: StatsMetricKey }) {
  const definition = STATS_METRICS[metric];
  if (!definition.description) return null;
  return <StatsTooltip label={`${definition.label} 指标说明`} content={definition.description} />;
}
