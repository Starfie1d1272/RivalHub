"use client";
import React from "react";

import type { ReactNode } from "react";
import type { StatsMetricKey } from "@/lib/stats/metrics";
import { STATS_METRICS } from "@/lib/stats/metrics";
import { formatStatsMetric, formatStatsRate, formatStatsSample, type StatsRateValue } from "@/lib/stats/presentation";

function isRateValue(value: number | StatsRateValue | null | undefined): value is StatsRateValue {
  return typeof value === "object" && value !== null && "rate" in value;
}

export function MetricValue({
  metric,
  value,
  sampleLabel,
}: {
  metric: StatsMetricKey;
  value: number | StatsRateValue | null | undefined;
  sampleLabel?: string;
}) {
  const main = isRateValue(value) ? formatStatsRate(metric, value) : formatStatsMetric(metric, value);
  const sample = isRateValue(value) ? formatStatsSample(value) : "";
  const definition = STATS_METRICS[metric];
  return (
    <span className="inline-flex flex-col items-start gap-0.5 tabular-nums">
      <span>{main}</span>
      {sample && <span className="text-xs font-normal text-[var(--color-fg-dim)]">{sample} {sampleLabel ?? definition.sampleLabel}</span>}
    </span>
  );
}

export function MetricPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <h3 className="mb-3 font-semibold">{title}</h3>
      {children}
    </section>
  );
}
