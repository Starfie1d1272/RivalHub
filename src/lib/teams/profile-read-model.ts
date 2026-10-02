import "server-only";

import type { PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";
import { getPublicSeasonCatalog, type PublicSeason } from "@/lib/data/public-seasons";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { getPublicLongTeamCareerDetail, getPublicTournamentTeamDetail } from "@/lib/stats/cached-query";
import { aggregatePublicTeamMapProfile, getPublicTeamMapProfile } from "@/lib/teams/map-profile";
import { getPublicTeamProfileCore, getTeamProfileViewerState, type PublicTeamIdentity } from "@/lib/teams/public-profile";
import { readOptionalPublicStats } from "@/lib/stats/availability";

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
  const performance = await readOptionalPublicStats("team_career", () => getPublicLongTeamCareerDetail(teamId));
  const core = await getPublicTeamProfileCore(teamId, knownTeam, performance?.official.matches);
  if (!core) return null;
  const profile = { ...core, ...await getTeamProfileViewerState(core, viewerUserId) };
  const entryIds = profile.entries.map((entry) => entry.id);
  const historicalSeasonIds = new Set(profile.entries.filter((entry) => ["finished", "archived"].includes(entry.seasonStatus)).map((entry) => entry.seasonId));
  const completedMaps = performance?.official.maps.filter((map) => map.completedAt !== null && map.scoreA !== null && map.scoreB !== null) ?? [];
  const preview = performance ? aggregatePublicTeamMapProfile(entryIds, performance.official.matches, completedMaps) : undefined;
  const [mapProfile, seasonCatalog] = await Promise.all([
    getPublicTeamMapProfile(entryIds, profile.currentMembers.map((member) => member.userId), preview),
    getPublicSeasonCatalog(),
  ]);
  const profileEntryRecords = new Map(performance?.official.entries.map((entry) => [entry.entryId, entry]) ?? []);
  const careerResults = await Promise.all(seasonCatalog.filter((season) => historicalSeasonIds.has(season.id)).map(async (season) => [season.id, await getPublicSeasonResults(season)] as const));
  const resultBySeason = new Map(careerResults);

  const career = profile.entries
    .filter((entry) => ["finished", "archived"].includes(entry.seasonStatus))
    .map((entry) => {
      const results = resultBySeason.get(entry.seasonId) ?? null;

      return {
        ...entry,
        placement: results?.placements.find((placement) => placement.entryId === entry.id)?.label ?? null,
        honors: results?.honors.filter((honor) => honor.entryId === entry.id).map((honor) => honor.label) ?? [],
        matchWins: performance ? profileEntryRecords.get(entry.id)?.matchWins ?? 0 : null,
        matchLosses: performance ? profileEntryRecords.get(entry.id)?.matchLosses ?? 0 : null,
        mapWins: performance ? profileEntryRecords.get(entry.id)?.mapWins ?? 0 : null,
        mapLosses: performance ? profileEntryRecords.get(entry.id)?.mapLosses ?? 0 : null,
        maps: performance ? profileEntryRecords.get(entry.id)?.maps ?? 0 : null,
      };
    });
  return {
    mode: "long" as const,
    profile,
    performance,
    statsUnavailable: performance === null,
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
  season: Pick<PublicSeason, "id" | "status">,
  event: PublicEventTeamContext,
) {
  const performance = await readOptionalPublicStats("event_team", () => getPublicTournamentTeamDetail(
    { seasonId: season.id, teamId: event.entry.id },
    season.status === "draft" ? "draft" : "public",
  ));
  const completedMaps = performance?.official.maps.filter((map) => map.completedAt !== null && map.scoreA !== null && map.scoreB !== null) ?? [];
  const preview = performance ? aggregatePublicTeamMapProfile([event.entry.id], performance.official.matches.filter((match) => match.status === "finished"), completedMaps) : undefined;
  const mapProfile = await getPublicTeamMapProfile(
    [event.entry.id],
    event.roster.map((member) => member.userId),
    preview,
  );
  return {
    mode: "event" as const,
    performance,
    statsUnavailable: performance === null,
    mapProfile,
    mapExperienceCoverage: mapProfile.experienceCoverage,
  };
}

export type PublicLongTeamProfileReadModel = NonNullable<Awaited<ReturnType<typeof getPublicLongTeamProfileReadModel>>>;
export type PublicCompetitionEntryPerformanceReadModel = Awaited<ReturnType<typeof getPublicCompetitionEntryPerformanceReadModel>>;
