import { safeStatsReturn } from "@/lib/stats/return-context";
import type { StatsSearch } from "@/lib/stats/view-state";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatsReturnLink } from "@/components/stats/StatsNavigationContext";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { notFound } from "next/navigation";

import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";
import { PageLayout } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { getPublicCompetitionEntryTeamContext } from "@/lib/competition-entries/public-team-context";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getMajorPublicParticipantTeam } from "@/lib/major/public-participants";
import { getPublicTeamProfile } from "@/lib/teams/public-profile";
import { getPublicCompetitionEntryPerformanceReadModel } from "@/lib/teams/profile-read-model";

export default function CompetitionEntryDetailPage(props: { params: Promise<{ seasonSlug: string; entryId: string }>; searchParams?: Promise<StatsSearch> }) {
  return <Suspense fallback={<PageLayout variant="standard"><p role="status">正在加载…</p></PageLayout>}><CompetitionEntryDetailPageContent {...props} /></Suspense>;
}
export async function CompetitionEntryDetailPageContent({ params, searchParams }: { params: Promise<{ seasonSlug: string; entryId: string }>; searchParams?: Promise<StatsSearch> }) {
  await connection();
  const [{ seasonSlug, entryId }, rawSearch] = await Promise.all([params, searchParams ?? Promise.resolve({} as StatsSearch)]);
  const fromStats = safeStatsReturn(typeof rawSearch.fromStats === "string" ? rawSearch.fromStats : null);
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  const [event, session] = await Promise.all([
    season.competitionTemplate === "major"
      ? getMajorPublicParticipantTeam(season, entryId)
      : getPublicCompetitionEntryTeamContext(season, entryId),
    getUserSession(),
  ]);
  if (!event) notFound();

  const [team, performanceModel, results] = await Promise.all([
    event.entry.teamId ? getPublicTeamProfile(event.entry.teamId, session?.userId) : Promise.resolve(null),
    getPublicCompetitionEntryPerformanceReadModel(season, event),
    getPublicSeasonResults(season),
  ]);
  return (
    <PageLayout as="div" variant="standard" className="space-y-8">
      <StatsReturnLink href={fromStats} />
      <TeamPublicProfile team={team} event={event} mapProfile={performanceModel.mapProfile} performance={performanceModel.performance} results={results} statsUnavailable={performanceModel.statsUnavailable} />
    </PageLayout>
  );
}
