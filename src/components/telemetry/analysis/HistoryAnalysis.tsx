"use client";
import { useEffect, useMemo, useState, startTransition } from "react";
import { getTelemetryHistoryAction } from "@/app/admin/telemetry/actions";
import { historyDefaults, summarizeHistory, historyDayStart, type HistoryData } from "@/lib/telemetry/history-contract";
import { metricLabels, opName, cat, readyModules, readyPhases } from "@/lib/telemetry/analysis-presentation";
import { Panel } from "@/components/rivalhub/Panel";
import { Button } from "@/components/ui/button";
import { taskLabel, taskOptions } from "./TaskAnalysis";
import { Empty, Heading, Pick, Series, Stat, date, duration, number } from "./Elements";

export function HistoryAnalysis({ events }: { events: { value: string; label: string }[] }) {
  const [filters, setFilters] = useState(historyDefaults);
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    startTransition(async () => { try {
      const result = await getTelemetryHistoryAction(filters);
      if (cancelled) return;
      if (result.status === "ready") setData(result.data); else setError(true);
    } catch { if (!cancelled) setError(true); } });
    return () => { cancelled = true; };
  }, [filters, refresh]);
  const summary = useMemo(() => data ? summarizeHistory(data) : null, [data]);
  const daily = summary && data ? Array.from({ length: Number(filters.days) }, (_, i) => {
    const at = historyDayStart(new Date(data.generatedAt + 8 * 3600000).toISOString().slice(0, 10)) - (Number(filters.days) - 1 - i) * 86400000;
    return { at, point: summary.byDay.find(p => historyDayStart(p.day) === at) };
  }) : [];
  const update = (key: keyof typeof filters, value: string) => { setData(null); setError(false); setFilters(old => ({ ...old, [key]: value })); };
  return <div className="space-y-4"><Panel contentClassName="p-4"><Heading title="长期趋势" note="独立使用下方条件；按北京时间自然日聚合，保留可合并的耗时分布。" />
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Pick label="历史范围" value={filters.days} all={false} options={[{ value: "28", label: "最近 28 天" }, { value: "90", label: "最近 90 天" }]} onChange={v => update("days", v)} /><Pick label="历史赛事" value={filters.eventId} options={events} onChange={v => update("eventId", v)} /><Pick label="历史任务" value={filters.task} options={taskOptions} onChange={v => update("task", v)} /><Button className="self-end" variant="outline" onClick={() => { setData(null); setError(false); setRefresh(n => n + 1); }}>刷新历史</Button></div>
  </Panel>{error ? <Panel><Empty>暂时无法读取历史聚合，请重试。</Empty></Panel> : !data ? <Panel><Empty>正在读取历史聚合…</Empty></Panel> : !data.enabled ? <Panel><Empty>长期聚合尚未启用。最近七天的分析仍可使用；启用后从实际收到的数据开始积累。</Empty></Panel> : summary && <>
    <p className="text-xs text-muted-foreground">保留 {data.retentionDays} 天 · 最早观测 {data.coverageStart ? date(data.coverageStart, true) : "—"} · 处理至 {data.processedThrough ? date(data.processedThrough, true) : "—"}</p>
    {(data.truncated || data.pendingBatches > 0) && <p role="status" className="rounded-sm border border-border p-3 text-sm">{data.truncated ? "当前结果超过查询预算，统计不完整。" : "聚合仍在更新。"} 待处理 {data.pendingBatches} 批。</p>}
    <Panel contentClassName="grid grid-cols-2 md:grid-cols-4 p-0"><Stat label="页面访问" value={number(summary.totals.views)} /><Stat label="操作调用" value={number(summary.totals.operations)} /><Stat label="任务开始" value={number(summary.totals.taskStarts)} /><Stat label="已观测任务完成" value={number(summary.totals.taskComplete)} /></Panel>
    <div className="grid gap-4 xl:grid-cols-2"><Series title="内容使用趋势" label="访问" note="尚未完整处理的日期保留空缺" points={daily.map(({ at, point: p }) => ({ at, value: p?.complete ? p.views : null, n: p?.views }))} /><Series title="任务开始与完成" note="按开始归属的累计结果；当日与仍可修订日期持续变化。" label="开始" secondaryLabel="完成" points={daily.map(({ at, point: p }) => ({ at, value: p?.complete ? p.taskStarts : null, secondary: p?.complete ? p.taskComplete : null, n: p?.taskStarts }))} /></div>
    <Panel contentClassName="p-0"><Heading title="期间耗时分布" note="合并分布桶后计算近似分位数，显示所在区间上界；少量样本仅展示中位数。" /><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-4">指标</th><th>结果</th><th>样本</th><th>近似 P50</th><th className="pr-4">近似 P90</th></tr></thead><tbody>{summary.timings.map(t => <tr key={`${t.kind}:${t.name}:${t.phase}:${t.measurementVersion}:${t.definitionVersion}:${t.navigationType}`} className="border-t border-border"><td className="p-4">{t.kind === "performance" ? metricLabels[t.name] ?? "性能指标" : t.kind === "operation" ? opName(t.name) : t.kind === "task" ? taskLabel(t.name) : "内容就绪"}{t.kind === "ready" && <span className="ml-1 text-xs text-muted-foreground">{readyModules[t.name.split(":")[0]] ?? "内容"} · {readyPhases[t.name.split(":")[1]] ?? "就绪"}</span>}</td><td>{t.phase ? cat(t.phase) : "—"}<p className="text-xs text-muted-foreground">{cat(t.navigationType)} · 采集 v{t.measurementVersion}{t.definitionVersion ? ` / 任务 v${t.definitionVersion}` : ""}</p></td><td>{t.n}</td><td>{duration(t.p50, t.name)}</td><td className="pr-4">{t.n >= 20 ? duration(t.p90, t.name) : "—"}</td></tr>)}</tbody></table></div>{!summary.timings.length && <Empty />}</Panel>
    <details className="text-xs text-muted-foreground"><summary>查看每天的数据状态</summary><div className="mt-3 flex flex-wrap gap-3">{summary.byDay.map(d => <span key={d.day}>{d.day} · {d.complete ? d.sealed ? "已封存" : "可修订" : "不完整"}</span>)}</div></details>
  </>}</div>;
}
