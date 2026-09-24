import "server-only";

import type { PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";
import { getPublicSeasonBySlug, type PublicSeason } from "@/lib/data/public-seasons";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
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
  const [mapProfile, careerResults] = await Promise.all([
    getPublicTeamMapProfile(
      profile.entries.map((entry) => entry.id),
      profile.currentMembers.map((member) => member.userId),
    ),
    Promise.all([...new Set(profile.entries.filter((entry) => ["finished", "archived"].includes(entry.seasonStatus)).map((entry) => entry.seasonSlug))].map(async (slug) => {
      const season = await getPublicSeasonBySlug(slug);
      return season ? [season.id, await getPublicSeasonResults(season)] as const : null;
    })),
  ]);
  const resultBySeason = new Map(careerResults.filter((row): row is NonNullable<typeof row> => row !== null));
  const performanceByEntry = new Map(performance.linkedEntries.map((entry) => [entry.entryId, entry]));
  const career = profile.entries
    .filter((entry) => ["finished", "archived"].includes(entry.seasonStatus))
    .map((entry) => {
      const results = [...resultBySeason.values()].find((result) =>
        result.placements.some((placement) => placement.entryId === entry.id)
        || result.honors.some((honor) => honor.entryId === entry.id)
      ) ?? null;
      const stats = performanceByEntry.get(entry.id);
      return {
        ...entry,
        placement: results?.placements.find((placement) => placement.entryId === entry.id)?.label ?? null,
        honors: results?.honors.filter((honor) => honor.entryId === entry.id).map((honor) => honor.label) ?? [],
        matchWins: stats?.matchWins ?? 0,
        matchLosses: stats?.matchLosses ?? 0,
        mapWins: stats?.mapWins ?? 0,
        mapLosses: stats?.mapLosses ?? 0,
        maps: stats?.maps ?? 0,
      };
    });
  return {
    mode: "long" as const,
    profile,
    performance,
    mapProfile,
    mapExperienceCoverage: mapProfile.experienceCoverage,
    career,
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
