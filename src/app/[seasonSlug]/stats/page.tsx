import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { TournamentStatsView } from "@/components/stats/TournamentStats";
import { getPublicOrAuthorizedDraftSeason, getPublicSeasonBySlug } from "@/lib/data/public-seasons";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { getPublicTournamentMapDetail, getPublicTournamentStats } from "@/lib/stats/cached-query";
import { parseStatsQuery, type StatsSearch } from "@/lib/stats/view-state";
import { ErrorCode, isAppErrorCode } from "@/lib/errors";
import { readOptionalPublicStats } from "@/lib/stats/availability";

interface StatsPageProps { params: Promise<{ seasonSlug: string }>; searchParams: Promise<StatsSearch> }

export async function generateMetadata({ params }: StatsPageProps): Promise<Metadata> {
  const season = await getPublicSeasonBySlug((await params).seasonSlug);
  return { title: season ? `${season.name} · 数据统计` : "数据统计" };
}

export default async function StatsPage({ params, searchParams }: StatsPageProps) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  const stages = normalizeStagePlan(season.stagePlan).map(({ key, name }) => ({ key, name }));
  const query = parseStatsQuery(await searchParams, stages.map((stage) => stage.key));
  const scope = { seasonId: season.id, stage: query.stage || undefined, format: query.format || undefined };
  const visibility = season.status === "draft" ? "draft" : "public";

  let data;
  let mapDetail;
  try {
    if (query.tab === "maps" && query.map) {
      mapDetail = await readOptionalPublicStats("tournament_map", () => getPublicTournamentMapDetail({ ...scope, map: query.map }, visibility)) ?? undefined;
    } else {
      data = await readOptionalPublicStats("tournament", () => getPublicTournamentStats({
        ...scope,
        mapFilter: query.tab === "players" || query.tab === "teams" || query.tab === "weapons" ? query.mapFilter || undefined : undefined,
        teamFilter: query.tab === "players" || query.tab === "weapons" ? query.teamFilter || undefined : undefined,
      }, visibility)) ?? undefined;
    }
  } catch (error) {
    if (isAppErrorCode(error, ErrorCode.NOT_FOUND)) notFound();
    throw error;
  }
  if (!data && !mapDetail) {
    return (
      <PageLayout as="div" variant="wide" className="space-y-6">
        <PageHeader title="数据统计" eyebrow={season.name} />
        <p role="status">统计数据暂时无法加载，请稍后重试。</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout as="div" variant="wide" className="space-y-6">
      <PageHeader title="数据统计" eyebrow={season.name} />
      <TournamentStatsView data={data} mapDetail={mapDetail} query={query} seasonSlug={seasonSlug} stages={stages} />
    </PageLayout>
  );
}
