"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { LongWindowSummary } from "@/lib/telemetry/long-window-contract";
import { historyBounds, historyQuantile } from "@/lib/telemetry/history-contract";
import { cat, metricLabels, opName, readyModules, readyPhases } from "@/lib/telemetry/analysis-presentation";
import { TASKS, type TaskName } from "@/lib/telemetry/task-contract";
import { Panel } from "@/components/rivalhub/Panel";
import { Button } from "@/components/ui/button";
import { Empty, Heading, SmallSample, Stat, MetricCard, CoverageBadge, Distribution, Pick, date, duration, number } from "./Elements";

type Metric = LongWindowSummary["metrics"][number];
const countLabels: Record<keyof LongWindowSummary["counts"], string> = {
  views: "页面访问", operations: "操作调用", success: "确认成功", rejected: "明确拒绝",
  unknown: "结果未知", pending: "未收到结果", taskStarts: "已观测任务开始",
  taskComplete: "已观测确认", taskExposure: "已观测资格曝光", errors: "异常报告",
};
const kindLabels: Record<string, string> = { performance: "浏览器性能", ready: "内容可用", task: "用户任务", operation: "操作响应" };
const basisLabel = (row: Metric) => row.kind === "ready" ? row.basis === "demand" ? "从需求触发开始" : "从导航开始" : "";
const versionLabel = (row: Metric) => row.kind === "operation" ? row.definitionVersion ? `附属定义 v${row.definitionVersion}` : "附属定义未关联/未知" : row.kind === "task" ? row.definitionVersion ? `定义 v${row.definitionVersion}` : "定义版本未知" : "";
const metricPhase = (row: Metric) => { const phase = row.kind === "ready" ? row.name.split(":")[1] ?? row.phase : row.phase; return row.kind === "ready" ? readyPhases[phase] ?? "其它阶段" : row.kind === "performance" ? "" : row.kind === "task" && phase === "complete" ? "已确认完成" : phase === "unknown" ? "结果未知" : cat(phase); };
function metricName(row: Metric) {
  if (row.kind === "performance") return metricLabels[row.name] ?? "其它性能指标";
  if (row.kind === "task") return TASKS[row.name as TaskName]?.label ?? "未知任务";
  if (row.kind === "ready") return readyModules[row.name.split(":")[0]] ?? "其它内容";
  return opName(row.name);
}
function metricKey(row: Metric) {
  return JSON.stringify([row.kind, row.name, row.phase, row.release, row.measurementVersion,
    row.definitionVersion, row.navigationType, row.kind === "ready" ? row.basis ?? "navigation" : "",
    row.elapsedCensored === true, row.activeCensored === true]);
}
const observed = (value: number | null) => value === null ? "未提供" : number(value);

/** Displays provider-merged distributions; it never averages daily percentiles. */
export function LongWindowAnalysis({ data, view = "overview", problemHref }: { data: LongWindowSummary; view?: string; problemHref?: Route }) {
  const [selectedKey, setSelectedKey] = useState("");
  const [clock, setClock] = useState<"duration" | "active">("duration");
  const supported = data.coverage.status !== "unsupported";
  const metrics = supported ? data.metrics.filter(row => view === "tasks" ? row.kind === "task" || row.kind === "operation" : view === "experience" ? row.kind === "ready" || row.kind === "performance" : view === "problems" ? false : true) : [];
  const selected = metrics.find(row => metricKey(row) === selectedKey) ?? metrics[0];
  const distribution = selected ? selected[selected.kind === "task" ? clock : "duration"] : null;
  const metric = selected?.name ?? "";
  const bounds = historyBounds(metric);
  const selectedTitle = selected ? [kindLabels[selected.kind] ?? "统计", metricName(selected),
    metricPhase(selected), versionLabel(selected), basisLabel(selected), selected.measurementVersion ? `测量 v${selected.measurementVersion}` : "测量版本未知",
    selected.release ? `版本 ${selected.release}` : "版本未提供", cat(selected.navigationType)].filter(Boolean).join(" · ") : "时长分布";
  const coverageDetails = (<Panel>
      <Heading title="长窗口汇总" note={data.coverage.status === "complete" ? "当前请求范围已覆盖" : data.coverage.status === "unsupported" ? "当前筛选不支持长窗口合并" : "当前请求范围覆盖不完整"} />
      <div className="space-y-2 p-4 text-sm">
        <p>请求范围：{date(data.requestedRange.from, true)} – {date(data.requestedRange.to, true)} · 北京时间</p>
        <p>有效范围：{date(data.effectiveRange.from, true)} – {date(data.effectiveRange.to, true)}</p>
        {data.coveredRanges.length ? <div>已覆盖区间：{data.coveredRanges.map((range, index) => <p key={`${range.from}:${range.to}:${index}`}>{date(range.from, true)} – {date(range.to, true)}</p>)}</div> : <p>尚无可确认的覆盖区间。</p>}
        {!supported && <p role="status">不支持的筛选：{data.unsupportedDimensions.map(dimension => ({ browser: "浏览器", source: "入口来源", visibility: "报告时可见性", scope: "工作范围", navigationType: "导航类型", session: "会话", releaseBasis: "版本口径", eventId: "赛事", ticketRelease: "票据签发版本", eventIdMissing: "未关联赛事" }[dimension] ?? "其它条件")).join("、")}。保留当前条件；不会显示未按这些条件筛选的历史数值。</p>}
        <details><summary>分段覆盖详情</summary>{data.coverage.segments.map((segment, index) => <p key={`${segment.from}:${segment.to}:${index}`}>{date(segment.from, true)} – {date(segment.to, true)} · {segment.source === "raw_edge" ? "原始边界" : "历史与尾部"} · {segment.status === "complete" ? "完整" : segment.status === "partial" ? "部分覆盖" : "覆盖未知"} · {segment.reason}</p>)}</details>
        {data.coverage.segments.some(segment => segment.status !== "complete") && <p>部分边界或历史区间尚未确认完整，已观测数值不能代表全部请求范围。</p>}
        {data.coverage.retentionUnknown && <p>部分请求早于可确认的原始保留范围。</p>}
        {data.coverage.pendingTailBatches > 0 && <p>待归入历史的尾部批次：{number(data.coverage.pendingTailBatches)}；是否影响完整性以覆盖状态为准。</p>}
        {data.coverage.tailBudgetTruncated && <p>尾部读取已达到预算。</p>}
        {data.coverage.rawBudgetTruncated && <p>边界读取已达到预算。</p>}
        {data.coverage.metricGroupsTruncated && <p>时长分布组已达到展示预算，不能把未列出的组当作没有样本。</p>}
        {data.coverage.seriesOmitted && <p>此汇总提供可合并分布，未提供逐时趋势。</p>}
      </div>
    </Panel>);
  const countKeys: (keyof LongWindowSummary["counts"])[] = view === "tasks" ? ["taskStarts", "taskComplete", "operations", "unknown"] : view === "problems" ? ["errors", "unknown", "rejected", "pending"] : view === "experience" || view === "quality" ? [] : ["views", "operations", "taskComplete", "errors"];
  return <div className="space-y-4">
    <CoverageBadge status={data.coverage.status} detail={data.coverage.status === "unsupported" ? "当前筛选不支持合并，请调整条件或进入有界证据。" : data.coverage.status === "partial" ? "当前范围覆盖不完整，数值为已观测部分。" : "客户端观测"} />
    {supported && countKeys.length > 0 && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{countKeys.map(key => <MetricCard key={key} label={countLabels[key]} value={observed(data.counts[key])} note={data.counts[key] == null ? "当前范围未提供" : data.coverage.status === "partial" ? "已观测 · 部分覆盖" : "当前范围已观测"} tone={key === "errors" && data.counts.errors ? "warn" : "neutral"} />)}</div>}
    {(view === "overview" || view === "tasks" || view === "quality") && supported && <p className="text-xs text-muted-foreground">已观测确认表示已观测到确认的任务数，不是成熟窗口完成率。缺失计数不补零。</p>}
    {view === "quality" ? coverageDetails : <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-1">范围与覆盖详情</summary><div className="mt-3">{coverageDetails}</div></details>}
    {supported && <>
      {view === "quality" && <Panel contentClassName="grid grid-cols-2 lg:grid-cols-4 p-0">{Object.entries(countLabels).map(([key, label]) => <Stat key={key} label={label} value={observed(data.counts[key as keyof typeof data.counts])} />)}<Stat label="不同会话" value={observed(data.distinctSessions)} note={data.distinctSessions === null ? "跨段无法可靠去重" : undefined} /><Stat label="不同账号" value={observed(data.distinctAccounts)} note={data.distinctAccounts === null ? "跨段无法可靠去重" : undefined} /></Panel>}
      {view !== "problems" && <>
      {metrics.length > 0 && <Panel contentClassName="p-4"><Pick label="分布统计组" all={false} value={selected ? metricKey(selected) : ""} options={metrics.map(row => ({ value: metricKey(row), label: [metricName(row), metricPhase(row), versionLabel(row), basisLabel(row), row.measurementVersion ? `测量 v${row.measurementVersion}` : "测量版本未知", row.release ? row.release.slice(0, 7) : "版本未提供", cat(row.navigationType), row.elapsedCensored ? "经过截断" : "", row.activeCensored ? "活跃截断" : ""].filter(Boolean).join(" · ") }))} onChange={setSelectedKey} /></Panel>}
      {!selected && <Panel><Empty>当前范围没有有效时长分布。</Empty></Panel>}
      <div className={view === "overview" ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]" : ""}>
      {selected && <Panel className="min-w-0" contentClassName="p-0">
        <Heading title={[kindLabels[selected.kind], metricName(selected), metricPhase(selected), versionLabel(selected), basisLabel(selected)].filter(Boolean).join(" · ")} note="仅当前统计组 · 桶计数分布" /><details className="px-4 pt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">统计组口径与版本</summary><p className="mt-2 break-words">{selectedTitle}</p></details>
        {selected.kind === "task" && <div className="flex gap-2 p-4"><Button size="sm" variant={clock === "duration" ? "secondary" : "ghost"} onClick={() => setClock("duration")}>经过时间</Button><Button size="sm" variant={clock === "active" ? "secondary" : "ghost"} onClick={() => setClock("active")}>活跃操作时间</Button></div>}
        {(selected.elapsedCensored || selected.activeCensored) && <p className="px-4 text-sm">该组有不可完整观测的耗时报告；确认报告保留，截断耗时不计入分位数。</p>}
        {!distribution?.n ? <Empty>此组没有有效时长样本。</Empty> : <div className="p-4"><div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground"><SmallSample n={distribution.n} /><span>P50 桶上界估计 {duration(historyQuantile(distribution, .5, metric), metric)}</span><span>最大观测值 {duration(distribution.max, metric)}</span></div><Distribution counts={distribution.counts} bounds={bounds} metric={metric} /></div>}
      </Panel>}
      {view === "overview" && problemHref && <Panel contentClassName="p-0"><Heading title="值得关注" note="异常与结果未知的客户端观测" /><div className="grid grid-cols-2"><Stat label="异常报告" value={observed(data.counts.errors)} /><Stat label="结果未知" value={observed(data.counts.unknown)} /></div><div className="space-y-3 border-t border-border p-4 text-sm"><p className="text-muted-foreground">{data.coverage.status === "partial" ? "当前范围覆盖不完整，可进入有界证据核对。" : "按页面、会话与请求线索查看问题证据。"}</p><Link prefetch={false} className="inline-flex rounded-md border border-border px-3 py-2 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary" href={problemHref}>查看问题证据 →</Link></div></Panel>}
      </div>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">查看全部统计组与分位数口径</summary><div className="mt-3">      <Panel contentClassName="p-0"><Heading title="可合并时长分布" note="分位数按合并后的桶计数估计，不平均每日分位数；不同定义、口径和版本分别保留。" />
        {!metrics.length ? <Empty>当前范围没有有效时长分布。</Empty> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-4">统计组</th><th>定义 / 口径</th><th>时长样本</th><th>P50 桶上界估计</th><th className="pr-4">最大观测值</th></tr></thead><tbody>{metrics.map(row => <tr key={metricKey(row)} className="border-t border-border"><td className="p-4"><button className="text-left hover:text-primary" onClick={() => setSelectedKey(metricKey(row))}>{kindLabels[row.kind] ?? "统计"} · {metricName(row)} · {metricPhase(row)} ↗</button><p className="mt-1 text-xs text-muted-foreground">{row.release || "版本未提供"} · {cat(row.navigationType)}</p></td><td>{[versionLabel(row), basisLabel(row)].filter(Boolean).join(" · ") || "—"}{(row.elapsedCensored || row.activeCensored) && <p className="text-xs">不可完整观测的报告：{row.reports == null ? "未提供" : number(row.reports)}；经过时间{row.elapsedCensored ? "截断" : "有效"}，活跃时间{row.activeCensored ? "截断" : "有效"}</p>}</td><td><SmallSample n={row.duration.n} /></td><td>{row.duration.n ? duration(historyQuantile(row.duration, .5, row.name), row.name) : "无有效时长样本"}</td><td className="pr-4">{row.duration.n ? duration(row.duration.max, row.name) : "—"}</td></tr>)}</tbody></table></div>}
      </Panel>
</div></details>
      </>}
    </>}
  </div>;
}
