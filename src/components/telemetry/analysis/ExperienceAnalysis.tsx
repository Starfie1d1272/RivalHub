"use client";
import { useState } from "react";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { cat } from "@/lib/telemetry/analysis-presentation";
import { Panel } from "@/components/rivalhub/Panel";
import { Empty, Heading, Pick, Series, SmallSample, Stat, duration } from "./Elements";
export function ExperienceAnalysis({ data }: { data: Analysis }) {
  const [metric, setMetric] = useState("LCP");
  const [readyKey, setReady] = useState("");
  const trend = data.product.performanceTrends.find(m => m.metric === metric);
  const metricData = data.metrics.find(m => m.key === metric);
  const ready = data.product.ready.find(r => `${r.route}:${r.module}:${r.phase}` === readyKey) ?? data.product.ready[0];
  return <div className="space-y-4">
    <Panel contentClassName="p-0"><Heading title="内容可用" note="从已观测导航起点到内容旁的就绪标记执行；每个导航、模块和阶段只取一次。" />
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-4">页面 / 内容</th><th>阶段</th><th>样本</th><th>P50</th><th className="pr-4">P90</th></tr></thead><tbody>{data.product.ready.map(r => <tr key={`${r.route}:${r.module}:${r.phase}`} className="border-t border-border"><td className="p-4"><button className="hover:text-primary" onClick={() => setReady(`${r.route}:${r.module}:${r.phase}`)}>{r.label} · {r.moduleLabel} ↗</button></td><td>{r.phaseLabel}</td><td><SmallSample n={r.n} /></td><td>{duration(r.p50)}</td><td className="pr-4">{r.n >= 20 ? duration(r.p90) : "—"}</td></tr>)}</tbody></table></div>
      {!data.product.ready.length && <Empty>尚无内容就绪样本；需要页面接入就绪标记并启用增强采集。</Empty>}
      {data.product.quality.readySeriesTruncated && <p className="p-4 text-xs text-muted-foreground">当前显示最活跃的 60 组内容；筛选页面可缩小范围。</p>}
    </Panel>
    {ready && <Series title={`${ready.label} · ${ready.moduleLabel} · ${ready.phaseLabel}`} label="P50" secondaryLabel="P90" format={duration} points={ready.points.map(p => ({ at: p.at, value: p.p50, secondary: p.n >= 20 ? p.p90 : null, n: p.n }))} />}
    <Panel contentClassName="p-0"><Heading title="浏览器性能" note="路由提交、内容就绪与 Web Vitals 各有测量边界，分别观察。" action={<div className="w-52"><Pick label="性能指标" value={metric} all={false} options={data.metrics.map(m => ({ value: m.key, label: m.label }))} onChange={setMetric} /></div>} />
      <div className="grid grid-cols-2 md:grid-cols-4"><Stat label="有效样本" value={metricData?.n ?? 0} note={(metricData?.n ?? 0) < 20 ? "少量样本，请结合单组范围观察" : undefined} /><Stat label="中位数 P50" value={duration(metricData?.p50, metric)} /><Stat label="P75" value={(metricData?.n ?? 0) >= 20 ? duration(metricData?.p75, metric) : "—"} /><Stat label="最大观测值" value={duration(metricData?.max, metric)} /></div>
    </Panel>
    {trend && <Series title={`${trend.label}趋势`} label="P50" secondaryLabel="P90" format={v => duration(v, metric)} points={trend.points.map(p => ({ at: p.at, value: p.p50, secondary: p.n >= 20 ? p.p90 : null, n: p.n }))} />}
    <div className="grid gap-4 xl:grid-cols-2"><Panel contentClassName="p-0"><Heading title="页面分布" note="同一指标按页面独立计算" /><div className="divide-y divide-border">{data.performanceRoutes.filter(r => r.metric === metric).map(r => <div key={r.route} className="flex items-center justify-between gap-3 p-4 text-sm"><span>{r.label}</span><span className="text-right">P50 {duration(r.p50, metric)}<span className="ml-3"><SmallSample n={r.n} /></span></span></div>)}</div></Panel>
      <Panel contentClassName="p-0"><Heading title="设备分布" note="缺失分类保持独立；设备差异可能影响总体值" /><div className="divide-y divide-border">{data.metricDevices.filter(r => r.metric === metric).map(r => <div key={r.device} className="flex items-center justify-between gap-3 p-4 text-sm"><span>{cat(r.device)}</span><span>P50 {duration(r.p50, metric)} <SmallSample n={r.n} /></span></div>)}</div></Panel></div>
    <Panel contentClassName="p-0"><Heading title="样本耗时分布" note="次数基于去重后的有效性能样本" /><div className="flex flex-wrap gap-6 p-4 text-sm">{data.histograms.filter(h => h.metric === metric).flatMap(h => h.counts.map((n, i) => <div key={i}><p className="text-xs text-muted-foreground">{i === 0 ? `≤ ${duration(h.bounds[0], metric)}` : i === h.bounds.length ? `> ${duration(h.bounds[i - 1], metric)}` : `${duration(h.bounds[i - 1], metric)} – ${duration(h.bounds[i], metric)}`}</p><p className="mt-2 text-xl tabular-nums">{n}</p></div>))}</div></Panel>
  </div>;
}
