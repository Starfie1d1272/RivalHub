import React from "react";
import Link from "next/link";
import type { Route } from "next";
import type { Insight } from "@/lib/stats/insights";
import { STATS_METRICS } from "@/lib/stats/metrics";
import { formatStatsMetric } from "@/lib/stats/presentation";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
export function Insights({ insights, query, seasonSlug }: { insights: Insight[]; query: StatsQuery; seasonSlug: string }) {
  if (!insights.length) return null;
  return <section aria-labelledby="insights-heading" className="space-y-3">
    <h2 id="insights-heading" className="text-base font-semibold">数据观察 / Insights</h2>
    <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {insights.map((insight) => <li key={`${insight.entityKey}:${insight.rule}`} className="space-y-2 py-3 text-sm">
        <p><Link href={insight.entityHref as Route} className="font-semibold hover:text-[var(--color-accent)]">{insight.entityName}</Link> · {insight.text}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">{insight.observations.map((o) => <span key={o.metric}>
          {o.metric === "friendlyBlindPerFlash" ? "队友致盲/Flash" : STATS_METRICS[o.metric].label}：{o.kind === "probability" ? `${o.x}/${o.n} · ${formatStatsMetric(o.metric === "friendlyBlindPerFlash" ? "netBlindPerFlash" : o.metric, o.value)}` : `${o.value!.toFixed(2)} 秒/颗 · ${o.n} 颗`}
        </span>)}</p>
        <div className="flex flex-wrap items-start gap-3 text-xs text-[var(--color-fg-mid)]">
          <span>{insight.scope}</span>
          <details className="min-w-0 flex-1"><summary className="w-fit cursor-pointer">为何出现</summary>
            <div className="mt-2 space-y-1 leading-5">{insight.observations.map((o) => <p key={o.metric}>
              {o.metric === "friendlyBlindPerFlash" ? "队友致盲/Flash" : STATS_METRICS[o.metric].label}：在 {o.count} 个合格对象中，分位 {(o.percentile * 100).toFixed(1)}%。
              {o.kind === "probability" ? ` 其它合格对象合计比例 ${formatStatsMetric(o.metric === "friendlyBlindPerFlash" ? "netBlindPerFlash" : o.metric, o.peerRate)}；通过区间宽度与下界展示稳定性检查。` : ` 累计 ${o.x.toFixed(2)} 秒 / ${o.n} 次投掷；逐图去除后的稳定性检查均通过。`}
            </p>)}<p>这是当前范围的描述性观察；回合相关性、对手与阵容变化未被校正，不作因果或显著性结论。组合规则比较各指标总体中的相对位置。</p></div>
          </details>
          <Link href={statsHref(seasonSlug, query, { tab: insight.entityKey.startsWith("player:") ? "players" : "teams" })} scroll={false} className="hover:text-[var(--color-accent)]">查看相关统计 →</Link>
        </div>
      </li>)}
    </ul>
  </section>;
}
