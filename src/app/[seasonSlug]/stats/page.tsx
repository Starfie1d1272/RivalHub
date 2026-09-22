import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { TournamentStatsView } from "@/components/stats/TournamentStats";
import { getPublicOrAuthorizedDraftSeason, getPublicSeasonBySlug } from "@/lib/data/public-seasons";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { getTournamentStats } from "@/lib/stats/tournament-query";
import { parseStatsQuery, type StatsSearch } from "@/lib/stats/query-state";

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
  const data = await getTournamentStats({ seasonId: season.id, stage: query.stage, map: query.map, team: query.team });
  return <PageLayout as="div" variant="wide" className="space-y-6"><PageHeader title="数据统计" eyebrow={season.name} /><TournamentStatsView data={data} query={query} seasonSlug={seasonSlug} stages={stages} /></PageLayout>;
}
