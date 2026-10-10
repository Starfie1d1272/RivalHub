import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { TournamentStatsView } from "@/components/stats/TournamentStats";
import { getPublicOrAuthorizedDraftSeason, getPublicSeasonBySlug } from "@/lib/data/public-seasons";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { getPublicTournamentMapDetail, getPublicTournamentStats } from "@/lib/stats/cached-query";
import { publicStatsView } from "@/lib/stats/public-view";
import { parseStatsQuery, statsHref, type StatsSearch } from "@/lib/stats/view-state";
import { ErrorCode, isAppErrorCode } from "@/lib/errors";
import { readOptionalPublicStats } from "@/lib/stats/availability";

interface StatsPageProps { params: Promise<{ seasonSlug: string }>; searchParams: Promise<StatsSearch> }

export async function generateMetadata({ params }: StatsPageProps): Promise<Metadata> {
  const season = await getPublicSeasonBySlug((await params).seasonSlug);
  return { title: season ? `${season.name} · 数据中心` : "数据中心", alternates: season ? { canonical: `/stats?event=${encodeURIComponent(season.slug)}` } : undefined };
}

export default async function StatsPage({ params, searchParams }: StatsPageProps) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  const stages = (await getPublicSeasonStagePresentation(season)).officialStages.map(({ key, name }) => ({ key, name }));
  const query = parseStatsQuery(await searchParams, stages.map((stage) => stage.key));
  if (query.stage === "__invalid__") notFound();
  if (season.status !== "draft") permanentRedirect(statsHref(seasonSlug, query));
  query.preview = true;
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
      <TournamentStatsView data={data ? publicStatsView(data, query) : undefined} mapDetail={mapDetail} query={query} seasonSlug={seasonSlug} stages={stages} />
    </PageLayout>
  );
}
