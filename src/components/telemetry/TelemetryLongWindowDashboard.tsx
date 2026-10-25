"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LongWindowSummary } from "@/lib/telemetry/long-window-contract";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import { analysisDefaults, type AnalysisFilters } from "@/lib/telemetry/analysis-query";
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
import { analysisHref, analysisSections } from "./analysis/navigation";
import { HistoryAnalysis } from "./analysis/HistoryAnalysis";
import { WorkflowAnalysis } from "./analysis/WorkflowAnalysis";
import { ContentReady } from "./ContentReady";

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
  return <PageLayout variant="workbench" className="space-y-5">
    <PageHeader title="产品使用与体验" description="观察内容使用、任务完成与等待；沿着趋势定位需要改进的环节。" actions={<Button variant="outline" onClick={() => router.refresh()}>刷新</Button>} />
    <nav aria-label="分析视图" className="flex gap-3 overflow-x-auto border-b border-border pb-2">{analysisSections.map(([key, label]) => <Link key={key} href={analysisHref(filters, key)} aria-current={key === view ? "page" : undefined}>{label}</Link>)}</nav>
    {!independent && <>
      <TelemetryFilters filters={filters} options={options} exactRelease apply={apply} reset={() => apply({ ...analysisDefaults })} update={(key, value) => {
        const next = { ...filters, [key]: value };
        if (key === "hours") { next.from = ""; next.to = ""; }
        if (key === "releaseBasis") next.release = "";
        if (key === "task") next.operation = "";
        apply(next);
      }} />
      <Panel><p className="text-sm">长窗口使用历史与尾部汇总。需要逐条问题证据或变化比较时，可打开<Link prefetch={false} className="ml-1 underline" href={analysisHref(filters, view, true)}>有界明细分析</Link>；其读取预算不代表完整长窗口。</p></Panel>
      {view === "problems" && <p className="text-sm">问题排查的会话证据保留在有界明细分析中。下方是当前条件的汇总覆盖与已观测计数。</p>}
      <LongWindowAnalysis data={data} view={view} />
      <ContentReady module="admin" phase="primary" />
    </>}
    {view === "history" && <HistoryAnalysis events={events} />}
    {view === "workflows" && <WorkflowAnalysis events={events} />}
  </PageLayout>;
}
