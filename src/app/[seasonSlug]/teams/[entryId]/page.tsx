import { notFound } from "next/navigation";

import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";
import { PageLayout } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { getPublicCompetitionEntryTeamContext } from "@/lib/competition-entries/public-team-context";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getPublicTeamProfile } from "@/lib/teams/public-profile";

export default async function CompetitionEntryDetailPage({ params }: { params: Promise<{ seasonSlug: string; entryId: string }> }) {
  const { seasonSlug, entryId } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();

  const [event, session] = await Promise.all([
    getPublicCompetitionEntryTeamContext(season, entryId),
    getUserSession(),
  ]);
  if (!event) notFound();

  const team = event.entry.teamId
    ? await getPublicTeamProfile(event.entry.teamId, session?.userId)
    : null;

  return (
    <PageLayout as="div" variant="standard" className="space-y-8">
      <TeamPublicProfile team={team} event={event} />
    </PageLayout>
  );
}
