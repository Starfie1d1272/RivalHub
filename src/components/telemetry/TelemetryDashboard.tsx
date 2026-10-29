"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { analysisFields, type AnalysisFilters } from "@/lib/telemetry/analysis-query";
import { getTelemetryAnalysisAction } from "@/app/admin/telemetry/actions";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TelemetryFilters } from "./TelemetryFilters";
import { analysisHref, isLongWindow, readTaskDefinition, parseUIAnalysisQuery, uiAnalysisDefaults } from "./analysis/navigation";
import { taskGroupKey, taskDefinitionLabel } from "./analysis/group-presentation";
import { AnalysisContentReady } from "./AnalysisContentReady";
import { Empty, Heading, Series, MetricCard, Bars, CoverageBadge, date, duration, number, vitalStatus } from "./analysis/Elements";
import { TaskAnalysis } from "./analysis/TaskAnalysis";
import { ExperienceAnalysis } from "./analysis/ExperienceAnalysis";
import { ProblemsAnalysis, QualityAnalysis } from "./analysis/EvidenceAnalysis";
import { Comparison } from "./analysis/Comparison";
import { WorkflowAnalysis } from "./analysis/WorkflowAnalysis";
import { HistoryAnalysis } from "./analysis/HistoryAnalysis";
const sections = [["overview", "产品概况"], ["tasks", "用户任务"], ["experience", "页面体验"], ["problems", "问题排查"], ["workflows", "业务流程"], ["history", "长期趋势"], ["quality", "数据质量"]];
export default function TelemetryDashboard({ initial, events, release, initialView = "overview", initialTaskDefinition = null }: { initialView?: string; initialTaskDefinition?: number | null; initial: Analysis; events: { value: string; label: string }[]; release?: { sha: string; tag: string } }) {
  const router = useRouter();
  const [taskDefinition, setTaskDefinition] = useState(initialTaskDefinition);
  const [filters, setFilters] = useState(initial.filters), [data, setData] = useState<Analysis | null>(initial);
  const [options, setOptions] = useState(initial.options), [section, setSection] = useState(initialView);
  const [session, setSession] = useState(""), [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  const [compare, setCompare] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    const read = () => { const p = new URLSearchParams(location.search); const parsed = parseUIAnalysisQuery(Object.fromEntries(analysisFields.flatMap(k => p.has(k) ? [[k, p.get(k)]] : []))); if (parsed && isLongWindow(parsed.filters) && p.get("analysisMode") !== "bounded") { setData(null); router.refresh(); return; } setTaskDefinition(readTaskDefinition(p.get("taskDefinition"))); if (parsed) { setData(null); setError(false); setSession(""); setFilters(parsed.filters); } else { setData(null); setError(true); } const tab = p.get("view"); setSection(sections.some(([v]) => v === tab) ? tab! : "overview"); };
    const timer = setTimeout(() => { const tab = new URLSearchParams(location.search).get("view"); if (sections.some(([v]) => v === tab)) setSection(tab!); }, 0);
    window.addEventListener("popstate", read); return () => { clearTimeout(timer); window.removeEventListener("popstate", read); };
  }, [router]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    let cancelled = false;
    startTransition(async () => { try { const result = await getTelemetryAnalysisAction({ ...filters, session }); if (cancelled) return; if (result.status === "ready") { setData(result.data); setError(false); setOptions(result.data.options); } else setError(true); } catch { if (!cancelled) setError(true); } });
    return () => { cancelled = true; };
  }, [filters, session, refresh]);
  function persist(next: AnalysisFilters, view = section, definition = taskDefinition) { window.history.pushState(null, "", analysisHref(next, view, true, false, definition)); }
  function apply(next: AnalysisFilters, view = section, definition = taskDefinition) {
    setData(null); setError(false); setSession("");
    if (isLongWindow(next) && !(isLongWindow(filters) && new URLSearchParams(location.search).get("analysisMode") === "bounded")) { router.push(analysisHref(next, view), { scroll: false }); return; }
    setFilters(next); setSection(view); persist(next, view, definition);
  }
  function update(key: keyof AnalysisFilters, value: string, view = section) {
    const next = { ...filters, [key]: value };
    if (key === "hours") { next.from = ""; next.to = ""; }
    if (key === "releaseBasis") next.release = "";
    if (key === "task") { next.operation = ""; setTaskDefinition(null); }
    apply(next, view, key === "task" ? null : taskDefinition);
  }
  function selectTask(name: string, version: number) { setTaskDefinition(version); const next = { ...filters, task: name, operation: "" }; setSection("tasks"); setData(null); setSession(""); setError(false); setFilters(next); persist(next, "tasks", version); }
  function navigate(view: string) { setSection(view); persist(filters, view); }
  const eventOptions = options.eventId.map(o => ({ ...o, label: events.find(e => e.value === o.value)?.label ?? o.label }));
  const releaseOptions = options.release.map(o => ({ ...o, label: release?.sha === o.value ? `${release.tag} · ${o.value.slice(0, 7)}` : o.label }));
  const mapped = data ? { ...data, options: { ...data.options, release: releaseOptions, eventId: eventOptions } } : null;
  const independent = section === "history" || section === "workflows";
  return <PageLayout variant="workbench" className="space-y-4"><Link href="/admin/telemetry?view=database">数据库流量来源</Link><PageHeader title="产品使用与体验" description="从使用趋势出发，找到值得关注的体验与任务。" className="pb-3" actions={<><Button variant="outline" onClick={() => setCompare(v => !v)} disabled={independent}>变化比较</Button><Button variant="outline" onClick={() => { setData(null); setError(false); setRefresh(n => n + 1); }} disabled={independent}>刷新</Button></>} />
    <nav aria-label="分析视图" className="flex gap-1 overflow-x-auto border-b border-border pb-2">{sections.map(([value, label]) => <Button key={value} variant={section === value ? "secondary" : "ghost"} size="sm" aria-current={section === value ? "page" : undefined} onClick={() => navigate(value)}>{label}</Button>)}</nav>
    {!independent && <><TelemetryFilters filters={filters} options={{ ...options, eventId: eventOptions, release: releaseOptions }} update={update} apply={apply} reset={() => { setTaskDefinition(null); apply({ ...uiAnalysisDefaults }, section, null); }} />
    {isLongWindow(filters) && <p role="status" className="text-sm">有界明细分析：读取预算可能截断此窗口。<Link prefetch={false} className="ml-1 underline" href={analysisHref(filters, section)}>返回长窗口汇总</Link></p>}
    {error ? <Panel><Empty>当前条件读取失败，请点击刷新重试。</Empty></Panel> : !mapped ? <Panel><Empty>正在读取当前条件的数据…</Empty></Panel> : <>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{date(mapped.product.window.from, true)} – {date(mapped.product.window.to, true)} · 北京时间</span><span>{mapped.meta.selected} 条报告 · 查询于 {date(mapped.meta.capturedAt)}</span></div>
      <CoverageBadge status={mapped.meta.partial ? "partial" : "complete"} detail={mapped.meta.partial ? "当前范围覆盖不完整，查看数据质量或缩小条件。" : "客户端观测"} />
      {compare && <Comparison data={mapped} />}
      {section === "overview" && <Overview data={mapped} navigate={navigate} update={update} selectTask={selectTask} />}
      {section === "tasks" && <TaskAnalysis data={mapped} update={update} definitionVersion={taskDefinition} selectTask={selectTask} />}
      {section === "experience" && <ExperienceAnalysis data={mapped} />}
      {section === "problems" && <ProblemsAnalysis data={mapped} session={session} selectSession={value => { setData(null); setError(false); setSession(value); }} />}
      {section === "quality" && <QualityAnalysis data={mapped} />}
      <AnalysisContentReady key={section} view={section} />
    </> }</>}
    {section === "workflows" && <WorkflowAnalysis events={events} />}{section === "history" && <HistoryAnalysis events={events} />}
  </PageLayout>;
}
function Overview({ data, navigate, update, selectTask }: { selectTask: (name: string, version: number) => void; data: Analysis; navigate: (view: string) => void; update: (key: keyof AnalysisFilters, value: string, view?: string) => void }) {
  const lcp = data.metrics.find(m => m.key === "LCP");
  const matureTasks = data.product.tasks.filter(t => t.matured > 0);
  const task = matureTasks.length === 1 && matureTasks[0].definitionVersion > 0 ? matureTasks[0] : undefined;
  const issues = [...data.errorGroups].sort((a, b) => b.sessions - a.sessions || b.n - a.n).slice(0, 4);
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard label="页面访问" value={number(data.totals.views)} note={`${number(data.totals.sessions)} 个观测会话`} onClick={() => navigate("overview")} />
      <MetricCard label="异常影响会话" value={number(data.totals.affectedSessions)} note={data.totals.affectedSessions ? "有客户端异常或结果未知" : "未观测到异常报告"} tone={data.totals.affectedSessions ? "warn" : "neutral"} onClick={() => navigate("problems")} />
      <MetricCard label="LCP P75" value={lcp && lcp.n >= 20 ? duration(lcp.p75) : "—"} note={vitalStatus("LCP", lcp?.n ?? 0, lcp?.p75, data.meta.partial).label} tone={vitalStatus("LCP", lcp?.n ?? 0, lcp?.p75, data.meta.partial).tone} onClick={() => navigate("experience")} />
      <MetricCard label={task ? "成熟任务完成" : "可评估任务"} value={task ? `${number(task.completionPct)}%` : number(matureTasks.length)} note={task ? `${task.label} · ${taskDefinitionLabel(task.definitionVersion)} · ${task.maturedCompleted}/${task.matured}` : "按任务定义查看成熟样本 →"} onClick={() => task ? selectTask(task.key, task.definitionVersion) : navigate("tasks")} />
    </div>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <Series title="访问与异常" label="页面访问" secondaryLabel="异常 / 结果未知" points={data.buckets.map(b => ({ at: b.at, value: b.views, secondary: b.errors, n: b.views }))} />
        <Series title="主动操作趋势" label="操作调用" secondaryLabel="筛选使用" points={data.buckets.map(b => ({ at: b.at, value: b.operations, secondary: b.filters, n: b.operations }))} />
      </div>
      <div className="min-w-0 space-y-4">
        <Panel contentClassName="p-0"><Heading title="值得关注" action={<Button variant="ghost" size="sm" onClick={() => navigate("problems")}>问题证据 →</Button>} />
          {issues.map(g => <button key={g.key} className="block w-full border-t border-border p-4 text-left hover:bg-secondary focus-visible:outline focus-visible:outline-primary" onClick={() => navigate("problems")}><span className="flex items-start justify-between gap-3 text-sm"><span>{g.label}</span><span className="shrink-0 text-[var(--color-warn)]">{number(g.sessions)} 会话</span></span><span className="mt-2 block text-xs text-muted-foreground">{g.reason} · {number(g.n)} 次报告</span></button>)}
          {!issues.length && <Empty>当前范围未观测到问题报告。</Empty>}
        </Panel>
        <Panel contentClassName="p-0"><Heading title="访问最多的页面" /><div className="p-4"><Bars rows={data.routes.slice(0, 5).map(r => ({ key: r.key, label: r.label, value: r.views, onClick: () => update("route", r.key, "experience") }))} unit="访问" /></div></Panel>
      </div>
    </div>
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">任务入口与操作明细</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.product.tasks.filter(t => t.views || t.start || t.attempts).map(t => <button key={taskGroupKey(t.key, t.definitionVersion)} className="rounded-md border border-border p-4 text-left hover:bg-secondary focus-visible:outline" onClick={() => selectTask(t.key, t.definitionVersion)}><span className="text-sm font-medium">{t.label} · {taskDefinitionLabel(t.definitionVersion)} ↗</span><span className="mt-2 block text-xs">{t.views} 访问 · {t.attempts} 次任务尝试</span></button>)}</div></details>
  </div>;
}
