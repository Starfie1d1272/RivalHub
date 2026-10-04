import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { TournamentStatsView } from "@/components/stats/TournamentStats";
import { StatsEventSelector } from "@/components/stats/StatsEventSelector";
import { getPlatformStatsPage } from "@/lib/stats/platform-query";
import { ErrorCode, isAppErrorCode } from "@/lib/errors";
import type { StatsSearch } from "@/lib/stats/view-state";

export const metadata: Metadata = { title: "数据中心", alternates: { canonical: "/stats" } };
export default function StatsPage({ searchParams }: { searchParams: Promise<StatsSearch> }) {
  return <PageLayout variant="wide" className="space-y-6"><PageHeader title="数据中心" />
    <Suspense fallback={<p role="status">统计数据加载中…</p>}><StatsContent searchParams={searchParams} /></Suspense>
  </PageLayout>;
}
async function StatsContent({ searchParams }: { searchParams: Promise<StatsSearch> }) {
  let result;
  try { result = await getPlatformStatsPage(await searchParams); }
  catch (error) { if (isAppErrorCode(error, ErrorCode.NOT_FOUND)) notFound(); throw error; }
  const { data, query, event, stages, events } = result;
  const mapDetail = query.tab === "maps" && query.map ? { map: query.map, results: data.results, selection: data.selection, coverage: data.coverage, analytics: data.analytics, performance: data.performance, entries: data.results.teams.map((t) => ({ id: t.entryId, name: t.name })) } : undefined;
  return <div className="space-y-4">
    <div className="flex min-w-0 flex-wrap items-center gap-3"><span className="text-sm">赛事</span><StatsEventSelector events={events} value={event?.slug ?? ""} query={query} /></div>
    <p className="text-xs text-[var(--color-fg-dim)]"><span className="relative inline-block">{event?.name ?? "All events"}<HelpTooltip className="absolute left-full top-1/2 ml-1 -translate-y-1/2" label="统计范围说明" content="汇总当前范围的公开赛事数据，包含已归档赛事。" /></span></p>
    <TournamentStatsView data={data} mapDetail={mapDetail} query={query} seasonSlug={event?.slug ?? ""} stages={stages} />
  </div>;
}
