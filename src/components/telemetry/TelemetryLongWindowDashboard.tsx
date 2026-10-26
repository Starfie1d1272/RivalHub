"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LongWindowSummary } from "@/lib/telemetry/long-window-contract";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { type AnalysisFilters } from "@/lib/telemetry/analysis-query";
import { CLIENT_CATEGORIES } from "@/lib/telemetry/client-context-contract";
import { ROLES } from "@/lib/telemetry/protocol";
import { ROUTES } from "@/lib/telemetry/routes";
import { OPERATIONS } from "@/lib/telemetry/operations";
import { TASK_NAMES, TASKS } from "@/lib/telemetry/task-contract";
import { cat, routeName, opName } from "@/lib/telemetry/analysis-presentation";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { TelemetryFilters } from "./TelemetryFilters";
import { LongWindowAnalysis } from "./analysis/LongWindowAnalysis";
import { analysisHref, analysisSections, uiAnalysisDefaults } from "./analysis/navigation";
import { HistoryAnalysis } from "./analysis/HistoryAnalysis";
import { WorkflowAnalysis } from "./analysis/WorkflowAnalysis";
import { AnalysisContentReady } from "./AnalysisContentReady";

const categories = (values: readonly string[]) => values.map(value => ({ value, label: cat(value) }));
export function TelemetryLongWindowDashboard({ data, filters, events, view }: {
  data: LongWindowSummary; filters: AnalysisFilters; events: { value: string; label: string }[]; view: string;
}) {
  const router = useRouter();
  const options: Analysis["options"] = {
    scene: categories(["major", "rivals", "other", "site"]), role: categories(ROLES),
    route: ["/unknown", ...ROUTES].map(value => ({ value, label: routeName(value) })),
    device: categories([...CLIENT_CATEGORIES.device, "missing"]), browser: categories([...CLIENT_CATEGORIES.browser, "missing"]),
    source: categories([...CLIENT_CATEGORIES.source, "missing"]), release: [], eventId: [...events, ...(filters.eventId && filters.eventId !== "missing" && !events.some(event => event.value === filters.eventId) ? [{ value: filters.eventId, label: "所选赛事（目录未提供）" }] : []), { value: "missing", label: "赛事未提供" }],
    task: TASK_NAMES.map(value => ({ value, label: TASKS[value].label })),
    operation: OPERATIONS.map(value => ({ value, label: opName(value) })),
    navigationType: categories(["hard", "soft", "bfcache", "prerender", "unknown", "missing"]),
    visibility: categories(["visible", "hidden", "missing"]),
  };
  const apply = (next: AnalysisFilters) => router.push(analysisHref(next, view), { scroll: false });
  const independent = view === "history" || view === "workflows";
  return <PageLayout variant="workbench" className="space-y-4">
    <PageHeader title="产品使用与体验" description="从使用分布出发，查看当前范围值得关注的体验。" className="pb-3" actions={<Button variant="outline" onClick={() => router.refresh()}>刷新</Button>} />
    <nav aria-label="分析视图" className="flex gap-3 overflow-x-auto border-b border-border pb-2">{analysisSections.map(([key, label]) => <Link prefetch={false} className={`shrink-0 rounded-md px-3 py-2 text-sm ${key === view ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`} key={key} href={analysisHref(filters, key)} aria-current={key === view ? "page" : undefined}>{label}</Link>)}</nav>
    {!independent && <>
      <TelemetryFilters filters={filters} options={options} exactRelease apply={apply} reset={() => apply({ ...uiAnalysisDefaults })} update={(key, value) => {
        const next = { ...filters, [key]: value };
        if (key === "hours") { next.from = ""; next.to = ""; }
        if (key === "releaseBasis") next.release = "";
        if (key === "task") next.operation = "";
        apply(next);
      }} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>长窗口汇总 · {data.coverage.seriesOmitted ? "此范围暂无趋势" : "使用已有汇总"}</span><div className="flex gap-4"><Link prefetch={false} className="underline" href={analysisHref(filters, "history")}>查看历史 →</Link><Link prefetch={false} className="underline" href={analysisHref(filters, view === "problems" ? "problems" : view, true)}>有界明细分析</Link></div></div>
      {view === "problems" && <Panel><p className="text-sm">下方是已观测异常计数；<Link prefetch={false} className="underline" href={analysisHref(filters, "problems", true)}>进入有界问题证据 →</Link></p></Panel>}
      <LongWindowAnalysis data={data} view={view} />
      <AnalysisContentReady key={view} view={view} />
    </>}
    {view === "history" && <HistoryAnalysis events={events} />}
    {view === "workflows" && <WorkflowAnalysis events={events} />}
  </PageLayout>;
}
