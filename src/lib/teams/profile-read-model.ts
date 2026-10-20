import "server-only";

import { getPublicLineupStyle } from "./lineup-style-query";

import { getPublicEventTeamMatchFacts, type PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";
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
  const entriesBySeason = Map.groupBy(profile.entries, entry => entry.seasonId);
  const [lineupStyle, mapProfile, seasonCatalog, matchesBySeason] = await Promise.all([
    readOptionalPublicStats("player_career", () => getPublicLineupStyle(profile.currentMembers)),
    getPublicTeamMapProfile(entryIds, profile.currentMembers.map((member) => member.userId), preview),
    getPublicSeasonCatalog(),
    Promise.all([...entriesBySeason].map(async ([seasonId, entries]) => {
      const facts = await getPublicEventTeamMatchFacts(seasonId, entries.map(entry => entry.id));
      return entries.flatMap(entry => (facts.get(entry.id)?.matches ?? []).map(match => ({
        ...match, seasonSlug: entry.seasonSlug, seasonName: entry.seasonName,
      })));
    })),
  ]);
  const matches = [...new Map(matchesBySeason.flat().map(match => [match.id, match])).values()];
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
        honorHistory: results?.honorHistory.filter((honor) => honor.entryId === entry.id) ?? [],
        matchWins: performance ? profileEntryRecords.get(entry.id)?.matchWins ?? 0 : null,
        matchLosses: performance ? profileEntryRecords.get(entry.id)?.matchLosses ?? 0 : null,
        mapWins: performance ? profileEntryRecords.get(entry.id)?.mapWins ?? 0 : null,
        mapLosses: performance ? profileEntryRecords.get(entry.id)?.mapLosses ?? 0 : null,
        maps: performance ? profileEntryRecords.get(entry.id)?.maps ?? 0 : null,
      };
    });
  return {
    mode: "long" as const,
    lineupStyle,
    profile,
    performance,
    statsUnavailable: performance === null,
    mapProfile,
    mapExperienceCoverage: mapProfile.experienceCoverage,
    career,
    matches,
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
  const [mapProfile, lineupStyle] = await Promise.all([
    getPublicTeamMapProfile([event.entry.id], event.roster.map((member) => member.userId), preview),
    readOptionalPublicStats("player_career", () => getPublicLineupStyle(event.roster)),
  ]);
  return {
    mode: "event" as const,
    lineupStyle,
    performance,
    statsUnavailable: performance === null,
    mapProfile,
    mapExperienceCoverage: mapProfile.experienceCoverage,
  };
}

export type PublicLongTeamProfileReadModel = NonNullable<Awaited<ReturnType<typeof getPublicLongTeamProfileReadModel>>>;
export type PublicCompetitionEntryPerformanceReadModel = Awaited<ReturnType<typeof getPublicCompetitionEntryPerformanceReadModel>>;
