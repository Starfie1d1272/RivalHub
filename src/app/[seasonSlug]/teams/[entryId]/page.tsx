import { ContentReady } from "@/components/telemetry/ContentReady";
import { TeamLineupStyle } from "@/components/teams/TeamLineupStyle";
import { TeamMapProfile } from "@/components/teams/TeamMapProfile";
import { TeamWorkspace, TeamRosterMapContext } from "@/components/stats/teams/TeamWorkspace";
import { safeStatsReturn } from "@/lib/stats/return-context";
import type { StatsSearch } from "@/lib/stats/view-state";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatsReturnLink } from "@/components/stats/StatsNavigationContext";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { notFound } from "next/navigation";

import { TeamPublicProfile, TeamProfileMetrics } from "@/components/teams/TeamPublicProfile";
import { PageLayout } from "@/components/rivalhub";
import { getPublicCompetitionEntryTeamContext } from "@/lib/competition-entries/public-team-context";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getMajorPublicParticipantTeam } from "@/lib/major/public-participants";
import { getPublicTeamProfileLink } from "@/lib/teams/public-profile";
import { startPublicCompetitionEntryPerformanceReadModel } from "@/lib/teams/profile-read-model";

export default function CompetitionEntryDetailPage(props: { params: Promise<{ seasonSlug: string; entryId: string }>; searchParams?: Promise<StatsSearch> }) {
  return <Suspense fallback={<PageLayout variant="wide"><p role="status">正在加载…</p></PageLayout>}><CompetitionEntryDetailPageContent {...props} /></Suspense>;
}
export async function CompetitionEntryDetailPageContent({ params, searchParams }: { params: Promise<{ seasonSlug: string; entryId: string }>; searchParams?: Promise<StatsSearch> }) {
  await connection();
  const [{ seasonSlug, entryId }, rawSearch] = await Promise.all([params, searchParams ?? Promise.resolve({} as StatsSearch)]);
  const fromStats = safeStatsReturn(typeof rawSearch.fromStats === "string" ? rawSearch.fromStats : null);
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  const event = await (season.competitionTemplate === "major"
      ? getMajorPublicParticipantTeam(season, entryId)
      : getPublicCompetitionEntryTeamContext(season, entryId));
  if (!event) notFound();

  const sections = startPublicCompetitionEntryPerformanceReadModel(season, event);
  const [team, results] = await Promise.all([
    event.entry.teamId ? getPublicTeamProfileLink(event.entry.teamId) : Promise.resolve(null),
    getPublicSeasonResults(season),
  ]);
  return (
    <PageLayout as="div" variant="wide" className="space-y-8">
      <StatsReturnLink href={fromStats} />
      <TeamPublicProfile team={null} linkedTeam={team} event={event} results={results}
        summaryContent={<Suspense fallback={<div className="h-20 border-t border-[var(--color-border)]" aria-busy="true" />}><EventMetrics sections={sections} event={event} /></Suspense>}
        lineupContent={<Suspense fallback={<AnalyticsFallback />}><EventLineup sections={sections} /></Suspense>}
        mapContent={<Suspense fallback={<AnalyticsFallback />}><EventMaps sections={sections} /></Suspense>}
        advancedContent={<Suspense fallback={<AnalyticsFallback />}><EventAdvanced sections={sections} /></Suspense>}
      />
      <ContentReady module="team" phase="primary" />
    </PageLayout>
  );
}

type Sections = ReturnType<typeof startPublicCompetitionEntryPerformanceReadModel>;
function AnalyticsFallback() {
  return <div className="min-h-64 border-y border-[var(--color-border)] bg-[var(--color-panel-low)]" aria-busy="true"><span className="sr-only">正在加载竞技分析…</span></div>;
}
async function EventMetrics({ sections, event }: { sections: Sections; event: NonNullable<Awaited<ReturnType<typeof getPublicCompetitionEntryTeamContext>>> }) {
  return <TeamProfileMetrics team={null} event={event} performance={await sections.performance} />;
}
async function EventLineup({ sections }: { sections: Sections }) {
  return <TeamLineupStyle members={await sections.lineupStyle} />;
}
async function EventMaps({ sections }: { sections: Sections }) {
  const detail = await sections.performance;
  return detail ? <TeamMapProfile title="本届地图画像" maps={detail.maps.map(({ mapName, results, selection }) => ({ mapName, results, selection }))} samples={detail.vetoActionSamples} /> : null;
}
async function EventAdvanced({ sections }: { sections: Sections }) {
  const [detail, mapProfile] = await Promise.all([sections.performance, sections.mapProfile, sections.lineupStyle]);
  return <>
    {detail ? <section className="space-y-4"><h2 className="text-lg font-semibold">竞技表现</h2><TeamWorkspace detail={{ teamId: detail.teamId, analytics: detail.analytics, performance: detail.performance, economyMatrix: detail.economyMatrix, selection: detail.selection, maps: detail.maps, scoreboard: detail.scoreboard, detailedPlayers: detail.detailedPlayers }} /></section>
      : <p role="status">竞技统计暂时无法加载，请稍后重试。</p>}
    <ContentReady module="team" phase="advanced" />
    <TeamRosterMapContext mapProfile={mapProfile} hasOwnMaps={Boolean(detail?.maps.some(row => (row.results?.played ?? 0) > 0))} />
  </>;
}
