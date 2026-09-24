import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { notFound } from "next/navigation";

import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";
import { PageLayout } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { getPublicCompetitionEntryTeamContext } from "@/lib/competition-entries/public-team-context";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getMajorPublicParticipantTeam } from "@/lib/major/public-participants";
import { getPublicTeamProfile } from "@/lib/teams/public-profile";
import { getPublicCompetitionEntryPerformanceReadModel } from "@/lib/teams/profile-read-model";

export default async function CompetitionEntryDetailPage({ params }: { params: Promise<{ seasonSlug: string; entryId: string }> }) {
  const { seasonSlug, entryId } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  const [event, session] = await Promise.all([
    season.competitionTemplate === "major"
      ? getMajorPublicParticipantTeam(season, entryId)
      : getPublicCompetitionEntryTeamContext(season, entryId),
    getUserSession(),
  ]);
  if (!event) notFound();

  const team = event.entry.teamId
    ? await getPublicTeamProfile(event.entry.teamId, session?.userId)
    : null;

  const [performanceModel, results, stagePresentation] = await Promise.all([
    getPublicCompetitionEntryPerformanceReadModel(season, event),
    getPublicSeasonResults(season),
    getPublicSeasonStagePresentation(season),
  ]);
  return (
    <PageLayout as="div" variant="standard" className="space-y-8">
      <TeamPublicProfile team={team} event={event} mapProfile={performanceModel.mapProfile} performance={performanceModel.performance} results={results} stageLabels={stagePresentation.labels} />
    </PageLayout>
  );
}
