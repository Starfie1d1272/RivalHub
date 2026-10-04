import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
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
    <p className="text-xs text-[var(--color-fg-dim)]">{event?.name ?? "全部公开赛事（含已归档历史）"} · 当前范围的描述性合计，未校正对手强度或阵容变化。</p>
    <TournamentStatsView data={data} mapDetail={mapDetail} query={query} seasonSlug={event?.slug ?? ""} stages={stages} />
  </div>;
}
