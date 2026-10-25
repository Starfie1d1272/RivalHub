"use client";
import { useEffect, useRef, useState, startTransition } from "react";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { analysisDefaults, analysisFields, parseAnalysisQuery, type AnalysisFilters } from "@/lib/telemetry/analysis-query";
import { getTelemetryAnalysisAction } from "@/app/admin/telemetry/actions";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TelemetryFilters } from "./TelemetryFilters";
import { analysisHref, isLongWindow, readTaskDefinition } from "./analysis/navigation";
import { taskGroupKey, taskDefinitionLabel, readyBasisLabel, sampledValue } from "./analysis/group-presentation";
import { ContentReady } from "./ContentReady";
import { Empty, Heading, Series, Stat, date, duration, number } from "./analysis/Elements";
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
    const read = () => { const p = new URLSearchParams(location.search); const parsed = parseAnalysisQuery(Object.fromEntries(analysisFields.flatMap(k => p.has(k) ? [[k, p.get(k)]] : []))); if (parsed && isLongWindow(parsed.filters) && p.get("analysisMode") !== "bounded") { setData(null); router.refresh(); return; } setTaskDefinition(readTaskDefinition(p.get("taskDefinition"))); if (parsed) { setData(null); setError(false); setSession(""); setFilters(parsed.filters); } else { setData(null); setError(true); } const tab = p.get("view"); setSection(sections.some(([v]) => v === tab) ? tab! : "overview"); };
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
    if (isLongWindow(next)) { router.push(analysisHref(next, view), { scroll: false }); return; }
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
  return <PageLayout variant="workbench" className="space-y-5"><PageHeader title="产品使用与体验" description="观察内容使用、任务完成与等待；沿着趋势定位需要改进的环节。" actions={<><Button variant="outline" onClick={() => setCompare(v => !v)} disabled={independent}>变化比较</Button><Button variant="outline" onClick={() => { setData(null); setError(false); setRefresh(n => n + 1); }} disabled={independent}>刷新</Button></>} />
    <nav aria-label="分析视图" className="flex gap-1 overflow-x-auto border-b border-border pb-2">{sections.map(([value, label]) => <Button key={value} variant={section === value ? "secondary" : "ghost"} size="sm" aria-current={section === value ? "page" : undefined} onClick={() => navigate(value)}>{label}</Button>)}</nav>
    {!independent && <><TelemetryFilters filters={filters} options={{ ...options, eventId: eventOptions, release: releaseOptions }} update={update} apply={apply} reset={() => { setTaskDefinition(null); apply({ ...analysisDefaults }, section, null); }} />
    {isLongWindow(filters) && <p role="status" className="text-sm">有界明细分析：读取预算可能截断此窗口。<Link className="ml-1 underline" href={analysisHref(filters, section)}>返回长窗口汇总</Link></p>}
    {error ? <Panel><Empty>当前条件读取失败，请点击刷新重试。</Empty></Panel> : !mapped ? <Panel><Empty>正在读取当前条件的数据…</Empty></Panel> : <>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{date(mapped.product.window.from, true)} – {date(mapped.product.window.to, true)} · 北京时间</span><span>{mapped.meta.selected} 条报告 · 查询于 {date(mapped.meta.capturedAt)}</span></div>
      {mapped.meta.partial && <p role="status" className="rounded-sm border border-border p-3 text-sm">当前观察范围不完整：{mapped.product.window.retentionClipped ? "日期已裁剪至七天保留范围。" : ""}{mapped.meta.truncated ? "读取达到批次或字节预算，请缩小条件。" : ""}</p>}
      {compare && <Comparison data={mapped} />}
      {section === "overview" && <Overview data={mapped} navigate={navigate} update={update} selectTask={selectTask} />}
      {section === "tasks" && <TaskAnalysis data={mapped} update={update} definitionVersion={taskDefinition} selectTask={selectTask} />}
      {section === "experience" && <ExperienceAnalysis data={mapped} />}
      {section === "problems" && <ProblemsAnalysis data={mapped} session={session} selectSession={value => { setData(null); setError(false); setSession(value); }} />}
      {section === "quality" && <QualityAnalysis data={mapped} />}
      <ContentReady module="admin" phase="primary" />
    </> }</>}
    {section === "workflows" && <WorkflowAnalysis events={events} />}{section === "history" && <HistoryAnalysis events={events} />}
  </PageLayout>;
}
function Overview({ data, navigate, update, selectTask }: { selectTask: (name: string, version: number) => void; data: Analysis; navigate: (view: string) => void; update: (key: keyof AnalysisFilters, value: string, view?: string) => void }) {
  const ready = data.product.ready[0];
  return <div className="space-y-4"><Panel contentClassName="grid grid-cols-2 lg:grid-cols-4 p-0"><Stat label="页面访问" value={number(data.totals.views)} /><Stat label="遥测会话" value={number(data.totals.sessions)} note={`${data.totals.accounts} 个登录账号；会话不等于人数`} /><Stat label={ready ? `${ready.moduleLabel}就绪 P50` : "内容就绪"} value={ready ? duration(sampledValue(ready.n, ready.p50)) : "尚无样本"} note={ready ? `${ready.n} 样本 · ${ready.label} · ${readyBasisLabel(ready.basis)}` : "增强采集开始后积累"} /><Stat label="异常影响会话" value={data.totals.affectedSessions} note={`${data.totals.errors} 条客户端异常 / ${data.totals.unknownReports} 条结果未知`} /></Panel>
    <div className="grid gap-4 xl:grid-cols-2"><Series title="内容使用趋势" label="页面访问" secondaryLabel="会话" points={data.buckets.map(b => ({ at: b.at, value: b.views, secondary: b.sessions, n: b.views }))} /><Series title="主动操作趋势" label="操作调用" secondaryLabel="筛选使用" points={data.buckets.map(b => ({ at: b.at, value: b.operations, secondary: b.filters, n: b.operations }))} /></div>
    <Panel contentClassName="p-0"><Heading title="任务使用与完成" action={<Button size="sm" variant="ghost" onClick={() => navigate("tasks")}>查看全部任务 →</Button>} /><div className="grid sm:grid-cols-2 xl:grid-cols-3">{data.product.tasks.filter(t => t.views || t.start || t.attempts).map(t => <button key={taskGroupKey(t.key, t.definitionVersion)} className="border-t border-border p-4 text-left hover:bg-secondary" onClick={() => { selectTask(t.key, t.definitionVersion); }}><p className="text-sm font-medium">{t.label} · {taskDefinitionLabel(t.definitionVersion)} ↗</p><p className="mt-2 text-xs text-muted-foreground">{t.views} 访问 · {t.start} 次调用 · {t.attempts} 次任务尝试</p><p className="mt-2 text-sm">{t.matured ? `${t.maturedCompleted}/${t.matured} 个成熟尝试完成` : "尚无成熟任务样本"}</p></button>)}</div></Panel>
    <div className="grid gap-4 xl:grid-cols-2"><Panel contentClassName="p-0"><Heading title="内容访问" note="按页面查看触达；访问本身也是内容使用。" /><div className="divide-y divide-border">{data.routes.slice(0, 12).map(r => <button key={r.key} className="flex w-full justify-between gap-3 p-4 text-left text-sm hover:bg-secondary" onClick={() => { update("route", r.key, "experience"); }}><span>{r.label} ↗</span><span>{r.views} 访问 · {r.sessions} 会话</span></button>)}</div></Panel>
      <Panel contentClassName="p-0"><Heading title="需要关注的问题" action={<Button variant="ghost" size="sm" onClick={() => navigate("problems")}>查看证据 →</Button>} />{data.errorGroups.slice(0, 6).map(g => <div key={g.key} className="border-t border-border p-4 text-sm"><p>{g.label} · {g.reason}</p><p className="mt-1 text-xs text-muted-foreground">{g.n} 次报告 · {g.sessions} 会话 · 最近 {date(g.last)}</p></div>)}{!data.errorGroups.length && <Empty>当前范围未观测到问题报告。</Empty>}</Panel></div>
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">查看筛选使用与操作类型</summary><div className="mt-3 grid gap-4 sm:grid-cols-2"><Panel><Heading title="筛选使用" />{data.filterRows.slice(0, 20).map(r => <p key={`${r.dimension}:${r.value}`} className="py-2 text-xs">{r.label} · {r.valueLabel}：{r.n} 次 / {r.sessions} 会话</p>)}</Panel><Panel><Heading title="操作类型" />{data.variants.slice(0, 20).map(r => <p key={`${r.operation}:${r.variant}`} className="py-2 text-xs">{r.label} · {r.variantLabel}：{r.n} 次</p>)}</Panel></div></details>
  </div>;
}
