import React from "react";
import Link from "next/link";
import type { Route } from "next";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import type { Insight, InsightMetric, InsightObservation } from "@/lib/stats/insights";
import { STATS_METRICS } from "@/lib/stats/metrics";
import { formatStatsMetric } from "@/lib/stats/presentation";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";

function metricLabel(metric: InsightMetric) {
  return metric === "friendlyBlindPerFlash" ? "Team Blind/Flash" : STATS_METRICS[metric].label;
}

function metricValue(observation: InsightObservation) {
  const metric = observation.metric === "friendlyBlindPerFlash" ? "netBlindPerFlash" : observation.metric;
  return observation.kind === "probability"
    ? `${observation.x}/${observation.n} · ${formatStatsMetric(metric, observation.value)}`
    : `${observation.value!.toFixed(2)} s/flash · ${observation.n} flashes`;
}

function openingRecoverySummary(insight: Insight) {
  if (insight.rule !== "opening_loss_recovery_profile") return null;
  const won = insight.observations.find((row) => row.metric === "winAfterOpeningLoss");
  const traded = insight.observations.find((row) => row.metric === "openingDeathTradedRate");
  if (!won || !traded || won.n !== traded.n) return null;
  return `FD ${won.n} · Traded ${traded.x} · Team Wins ${won.x}`;
}

export function Insights({ insights, query, seasonSlug }: { insights: Insight[]; query: StatsQuery; seasonSlug: string }) {
  if (!insights.length) return null;
  return <section aria-labelledby="insights-heading" className="space-y-3">
    <h2 id="insights-heading" className="text-base font-semibold"><span className="relative inline-block">Insights<HelpTooltip className="absolute left-full top-1/2 ml-1 -translate-y-1/2" label="Insights 说明" content="从当前范围的数据中筛选出的突出表现与差异。" /></span></h2>
    <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {insights.map((insight) => {
        const openingSummary = openingRecoverySummary(insight);
        return <li key={`${insight.entityKey}:${insight.rule}`} className="space-y-2 py-3 text-sm">
          <p><Link href={insight.entityHref as Route} className="font-semibold hover:text-[var(--color-accent)]">{insight.entityName}</Link> · {insight.text}</p>
          {openingSummary
            ? <p className="tabular-nums">{openingSummary}</p>
            : <p className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">{insight.observations.map((o) => <span key={o.metric}>{metricLabel(o.metric)}：{metricValue(o)}</span>)}</p>}
          <div className="flex flex-wrap items-start gap-3 text-xs text-[var(--color-fg-mid)]">
            <details className="min-w-0 flex-1"><summary className="w-fit cursor-pointer">Why?</summary>
              <div className="mt-2 space-y-1 leading-5">
                <p>{insight.scope}</p>
                {insight.observations.map((o) => <p key={o.metric}>
                  {metricLabel(o.metric)}：P{(o.percentile * 100).toFixed(1)}
                  {o.kind === "probability" && o.peerRate !== undefined ? ` · Peers ${formatStatsMetric(o.metric, o.peerRate)}` : ""}
                </p>)}
              </div>
            </details>
            <Link href={statsHref(seasonSlug, query, { tab: insight.entityKey.startsWith("player:") ? "players" : "teams" })} scroll={false} className="hover:text-[var(--color-accent)]">Stats →</Link>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
