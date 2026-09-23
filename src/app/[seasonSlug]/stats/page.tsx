import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { TournamentStatsView } from "@/components/stats/TournamentStats";
import { getPublicOrAuthorizedDraftSeason, getPublicSeasonBySlug } from "@/lib/data/public-seasons";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { getTournamentMapDetail, getTournamentStats, getTournamentTeamDetail } from "@/lib/stats/tournament-query";
import { parseStatsQuery, type StatsSearch } from "@/lib/stats/view-state";

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
  const scope = { seasonId: season.id, stage: query.stage || undefined };

  let data;
  let teamDetail;
  let mapDetail;
  if (query.tab === "teams" && query.team) {
    teamDetail = await getTournamentTeamDetail({ ...scope, mapFilter: query.mapFilter || undefined, teamId: query.team });
  } else if (query.tab === "maps" && query.map) {
    mapDetail = await getTournamentMapDetail({ ...scope, map: query.map });
  } else {
    data = await getTournamentStats({
      ...scope,
      mapFilter: query.tab === "players" || query.tab === "teams" ? query.mapFilter || undefined : undefined,
      teamFilter: query.tab === "players" ? query.teamFilter || undefined : undefined,
    });
  }

  return (
    <PageLayout as="div" variant="wide" className="space-y-6">
      <PageHeader title="数据统计" eyebrow={season.name} />
      <TournamentStatsView data={data} teamDetail={teamDetail} mapDetail={mapDetail} query={query} seasonSlug={seasonSlug} stages={stages} />
    </PageLayout>
  );
}
