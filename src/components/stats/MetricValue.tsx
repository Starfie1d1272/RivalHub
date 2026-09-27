"use client";
import React from "react";

import type { ReactNode } from "react";
import type { StatsMetricKey, MetricSampleMode } from "@/lib/stats/metrics";
import { STATS_METRICS } from "@/lib/stats/metrics";
import { formatStatsDenominator, formatStatsMetric, formatStatsRate, formatStatsSample, type StatsRateValue } from "@/lib/stats/presentation";

function isRateValue(value: number | StatsRateValue | null | undefined): value is StatsRateValue {
  return typeof value === "object" && value !== null && "rate" in value;
}

type SampleDisplay = "auto" | "full" | "compact" | "denominator" | "hidden";

function resolvedSampleMode(metric: StatsMetricKey, sampleDisplay: SampleDisplay): MetricSampleMode | "compact" | "full" {
  if (sampleDisplay === "auto") return STATS_METRICS[metric].sampleMode;
  return sampleDisplay;
}

export function MetricValue({ metric, value, sampleLabel, sampleDisplay = "auto" }: {
  metric: StatsMetricKey;
  value: number | StatsRateValue | null | undefined;
  sampleLabel?: string;
  sampleDisplay?: SampleDisplay;
}) {
  const main = isRateValue(value) ? formatStatsRate(metric, value) : formatStatsMetric(metric, value);
  const definition = STATS_METRICS[metric];
  const mode = resolvedSampleMode(metric, sampleDisplay);
  let sample = "";

  if (isRateValue(value) && mode !== "hidden") {
    if (mode === "denominator") {
      const denominator = formatStatsDenominator(value);
      sample = denominator ? `${denominator} ${sampleLabel ?? definition.sampleLabel}` : "";
    } else {
      const fraction = formatStatsSample(value);
      if (fraction) sample = mode === "compact" ? fraction.replace("/", " / ") : `${fraction} ${sampleLabel ?? definition.sampleLabel}`;
    }
  }

  return (
    <span className="stats-metric-value inline-flex flex-col items-start gap-0.5 tabular-nums leading-5">
      <span>{main}</span>
      {sample && <span className="text-xs font-normal leading-4 text-[var(--color-fg-dim)]">{sample}</span>}
    </span>
  );
}

export function MetricPanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <section className="min-w-0 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] p-4"><h3 className="mb-3 font-semibold">{title}</h3>{children}</section>;
}
