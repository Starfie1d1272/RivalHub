"use client";
import { useState } from "react";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { cat } from "@/lib/telemetry/analysis-presentation";
import { Panel } from "@/components/rivalhub/Panel";
import { Empty, Heading, Pick, Series, SmallSample, MetricCard, Bars, Distribution, duration, vitalStatus } from "./Elements";
import { readyBasisLabel, readyGroupKey, sampledValue } from "./group-presentation";
export function ExperienceAnalysis({ data }: { data: Analysis }) {
  const [metric, setMetric] = useState("LCP");
  const [readyKey, setReady] = useState("");
  const trend = data.product.performanceTrends.find(m => m.metric === metric);
  const ready = data.product.ready.find(r => readyGroupKey(r) === readyKey) ?? data.product.ready[0];
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">{["LCP", "INP", "CLS"].map(key => {
      const m = data.metrics.find(row => row.key === key), status = vitalStatus(key, m?.n ?? 0, m?.p75, data.meta.partial);
      return <MetricCard key={key} label={`${key} P75`} value={m && m.n >= 20 ? duration(m.p75, key) : "—"} note={status.label} tone={status.tone} onClick={() => setMetric(key)} />;
    })}</div>
    <Panel contentClassName="p-0"><Heading title="浏览器性能" note="路由提交、内容就绪与 Web Vitals 各有测量边界，分别观察。" action={<div className="w-52"><Pick label="性能指标" value={metric} all={false} options={data.metrics.map(m => ({ value: m.key, label: m.label }))} onChange={setMetric} /></div>} />
      <p className="px-4 py-3 text-xs text-muted-foreground">按当前设备筛选观察 · <a className="underline" href="https://web.dev/articles/vitals" target="_blank" rel="noreferrer">P75 参考</a>：LCP ≤ 2.5 秒 · INP ≤ 200 ms · CLS ≤ 0.1。本面板少于 20 样本暂不评价。</p>
    </Panel>
    {trend && <Series title={`${trend.label}趋势`} label="P50" secondaryLabel="P90" format={v => duration(v, metric)} points={trend.points.map(p => ({ at: p.at, value: sampledValue(p.n, p.p50), secondary: p.n >= 20 ? p.p90 : null, n: p.n }))} />}
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel contentClassName="p-0"><Heading title="慢页面" note={`${metric} 中位数 · 各页面独立计算`} /><div className="p-4"><Bars unit="" rows={data.performanceRoutes.filter(r => r.metric === metric && r.n > 0 && r.p50 != null).sort((a, b) => (b.p50 ?? 0) - (a.p50 ?? 0)).slice(0, 8).map(r => ({ key: r.route, label: `${r.label} · ${r.n} 样本${r.n < 20 ? " · 样本不足" : ""}`, value: r.p50!, displayValue: duration(r.p50, metric) }))} /></div></Panel>
      <Panel contentClassName="p-0"><Heading title="样本耗时分布" note="去重后的有效性能样本" /><div className="p-4">{data.histograms.filter(h => h.metric === metric && h.counts.some(Boolean)).map(h => <Distribution key={h.metric} counts={h.counts} bounds={h.bounds} metric={metric} />)}{!data.histograms.some(h => h.metric === metric && h.counts.some(Boolean)) && <Empty>当前指标暂无有效样本。</Empty>}</div></Panel>
    </div>
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer py-2">设备样本与内容就绪详情</summary><div className="mt-3 space-y-4">
      <Panel contentClassName="p-0"><Heading title="设备分布" /><div className="divide-y divide-border">{data.metricDevices.filter(r => r.metric === metric).map(r => <div key={r.device} className="flex items-center justify-between gap-3 p-4 text-sm"><span>{cat(r.device)}</span><span>P50 {duration(r.p50, metric)} <SmallSample n={r.n} /></span></div>)}</div></Panel>
    <Panel contentClassName="p-0"><Heading title="内容可用" note="导航与需求触发分别计时；相同页面、模块和阶段按起点口径独立观察。" />
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-4">页面 / 内容</th><th>阶段</th><th>样本</th><th>P50</th><th className="pr-4">P90</th></tr></thead><tbody>{data.product.ready.map(r => <tr key={readyGroupKey(r)} className="border-t border-border"><td className="p-4"><button className="hover:text-primary" onClick={() => setReady(readyGroupKey(r))}>{r.label} · {r.moduleLabel} ↗</button></td><td>{r.phaseLabel} · {readyBasisLabel(r.basis)}</td><td><SmallSample n={r.n} /></td><td>{duration(sampledValue(r.n, r.p50))}</td><td className="pr-4">{r.n >= 20 ? duration(r.p90) : "—"}</td></tr>)}</tbody></table></div>
      {!data.product.ready.length && <Empty>尚无内容就绪样本；需要页面接入就绪标记并启用增强采集。</Empty>}
      {data.product.quality.readySeriesTruncated && <p className="p-4 text-xs text-muted-foreground">汇总最多显示 60 组内容，趋势仅展示最活跃的 12 组；选择页面可缩小范围。</p>}
    </Panel>
    {ready && !ready.points.length && <p className="text-sm text-muted-foreground">此组已有汇总样本，趋势超出当前展示预算；请选择该页面后查看。</p>}
    {ready && ready.points.length > 0 && <Series title={`${ready.label} · ${ready.moduleLabel} · ${ready.phaseLabel} · ${readyBasisLabel(ready.basis)}`} label="P50" secondaryLabel="P90" format={duration} points={ready.points.map(p => ({ at: p.at, value: sampledValue(p.n, p.p50), secondary: p.n >= 20 ? p.p90 : null, n: p.n }))} />}
    </div></details>
  </div>;
}
