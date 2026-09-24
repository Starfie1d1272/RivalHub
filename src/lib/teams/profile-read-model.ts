import "server-only";

import type { PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";
import type { PublicSeason } from "@/lib/data/public-seasons";
import { getLongTeamCareerDetail, getTournamentTeamDetail } from "@/lib/stats/tournament-query";
import { getPublicTeamMapProfile } from "@/lib/teams/map-profile";
import { getPublicTeamProfile, type PublicTeamIdentity } from "@/lib/teams/public-profile";

/**
 * Profile-facing projection for a stable Team identity.
 *
 * The public identity/lifecycle owner remains public-profile.ts; canonical
 * all-time competitive analytics is projected independently from linked public
 * CompetitionEntries and immutable confirmed facts.
 */
export async function getPublicLongTeamProfileReadModel(
  teamId: string,
  viewerUserId?: string | null,
  knownTeam?: PublicTeamIdentity,
) {
  const [profile, performance] = await Promise.all([
    getPublicTeamProfile(teamId, viewerUserId, knownTeam),
    getLongTeamCareerDetail(teamId),
  ]);
  if (!profile) return null;
  const mapProfile = await getPublicTeamMapProfile(
    profile.entries.map((entry) => entry.id),
    profile.currentMembers.map((member) => member.userId),
  );
  return {
    mode: "long" as const,
    profile,
    performance,
    mapProfile,
    mapExperienceCoverage: mapProfile.experienceCoverage,
  };
}

/**
 * Event analytics keeps CompetitionEntry as the canonical Team key. Long Team
 * linkage is presentation context only and never rewrites this event identity.
 */
export async function getPublicCompetitionEntryPerformanceReadModel(
  season: Pick<PublicSeason, "id">,
  event: PublicEventTeamContext,
) {
  const performance = await getTournamentTeamDetail({ seasonId: season.id, teamId: event.entry.id });
  const mapProfile = await getPublicTeamMapProfile(
    [event.entry.id],
    event.roster.map((member) => member.userId),
  );
  return {
    mode: "event" as const,
    performance,
    mapProfile,
    mapExperienceCoverage: mapProfile.experienceCoverage,
  };
}

export type PublicLongTeamProfileReadModel = NonNullable<Awaited<ReturnType<typeof getPublicLongTeamProfileReadModel>>>;
export type PublicCompetitionEntryPerformanceReadModel = Awaited<ReturnType<typeof getPublicCompetitionEntryPerformanceReadModel>>;
