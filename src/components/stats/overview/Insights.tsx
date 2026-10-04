import React from "react";
import Link from "next/link";
import type { Route } from "next";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import type { Insight } from "@/lib/stats/insights";
import { STATS_METRICS } from "@/lib/stats/metrics";
import { formatStatsMetric } from "@/lib/stats/presentation";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
export function Insights({ insights, query, seasonSlug }: { insights: Insight[]; query: StatsQuery; seasonSlug: string }) {
  if (!insights.length) return null;
  return <section aria-labelledby="insights-heading" className="space-y-3">
    <h2 id="insights-heading" className="text-base font-semibold"><span className="relative inline-block">Insights<HelpTooltip className="absolute left-full top-1/2 ml-1 -translate-y-1/2" label="Insights 说明" content="当前范围中样本达标、相对靠前的描述性观察。不是因果或显著性结论。" /></span></h2>
    <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
      {insights.map((insight) => <li key={`${insight.entityKey}:${insight.rule}`} className="space-y-2 py-3 text-sm">
        <p><Link href={insight.entityHref as Route} className="font-semibold hover:text-[var(--color-accent)]">{insight.entityName}</Link> · {insight.text}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">{insight.observations.map((o) => <span key={o.metric}>
          {o.metric === "friendlyBlindPerFlash" ? "Team blind/Flash" : STATS_METRICS[o.metric].label}：{o.kind === "probability" ? `${o.x}/${o.n} · ${formatStatsMetric(o.metric === "friendlyBlindPerFlash" ? "netBlindPerFlash" : o.metric, o.value)}` : `${o.value!.toFixed(2)} 秒/颗 · ${o.n} 颗`}
        </span>)}</p>
        <div className="flex flex-wrap items-start gap-3 text-xs text-[var(--color-fg-mid)]">
          <details className="min-w-0 flex-1"><summary className="w-fit cursor-pointer">Why?</summary>
            <div className="mt-2 space-y-1 leading-5"><p>{insight.scope}</p>{insight.observations.map((o) => <p key={o.metric}>
              {o.metric === "friendlyBlindPerFlash" ? "Team blind/Flash" : STATS_METRICS[o.metric].label}：在 {o.count} 个合格对象中，分位 {(o.percentile * 100).toFixed(1)}%。
              {o.kind === "probability" ? ` 其它合格对象合计比例 ${formatStatsMetric(o.metric === "friendlyBlindPerFlash" ? "netBlindPerFlash" : o.metric, o.peerRate)}；样本线 ${o.insightFloor}。` : ` 累计 ${o.x.toFixed(2)} 秒 / ${o.n} 次投掷；逐图去除后的稳定性检查均通过。`}
            </p>)}<p>描述性观察，未校正对手、阵容与回合相关性，不作因果或显著性结论。组合规则比较各指标的相对位置。</p>{insight.rule === "opening_loss_recovery_profile" && <p>两项共用首死次数；被补枪与队伍取胜不一定发生在同一批回合，不能推断交集。</p>}</div>
          </details>
          <Link href={statsHref(seasonSlug, query, { tab: insight.entityKey.startsWith("player:") ? "players" : "teams" })} scroll={false} className="hover:text-[var(--color-accent)]">Stats →</Link>
        </div>
      </li>)}
    </ul>
  </section>;
}
