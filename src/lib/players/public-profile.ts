import "server-only";

import { and, asc, desc, eq, inArray, isNull, max, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, educationVerifications, eventRosterMembers, eventRosters, institutions, matches, seasonRegistrations, seasons, teamMemberships, teams, userCompetitiveRoles, userMapPreferences, competitiveRankFacts } from "@/db/schema";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { getPublicPlayerById } from "@/lib/data/public-players";
import { getPublicSeasonBySlug } from "@/lib/data/public-seasons";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { getPlayerCareerDetail, type PlayerStatsEventOption } from "@/lib/stats/tournament-query";
import { getPlayerAttributeBenchmarkPopulation } from "@/lib/stats/player-attribute-benchmark";
import { buildPlayerAttributeProfile } from "@/lib/stats/player-attributes";
import { getPublicPlayerRecords } from "./public-record";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";
import { presentCompetitiveRole, presentPublicCompetitiveProfile } from "@/lib/competitive/presentation";
import { presentPublicEducationIdentities } from "@/lib/education/presentation";
import { getPublicPlayerLft } from "@/lib/recruitment/data";

export type PublicPlayerCareerEvent = {
  seasonId: string;
  seasonSlug: string;
  seasonName: string;
  seasonStatus: string;
  teamId: string;
  teamName: string;
  placement: string | null;
  honors: string[];
  record: { wins: number; losses: number; played: number };
};

export async function getPublicPlayerProfileReadModel(
  userId: string,
  scope: { eventSlug?: string; mapFilter?: string } = {},
) {
  const attributePopulationPromise = getPlayerAttributeBenchmarkPopulation();
  const [user, career, currentTeams, registrations, competitiveFacts, competitiveRoles, mapPreferences, competitiveCatalog, educationRows, playerLft, teamMemberRows, careerRecords] = await Promise.all([
    getPublicPlayerById(userId),
    getPlayerCareerDetail({ playerId: userId, eventSlug: scope.eventSlug, mapFilter: scope.mapFilter }),
    db.select({ slug: teams.slug, name: teams.name }).from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(and(eq(teamMemberships.userId, userId), isNull(teamMemberships.endedAt), eq(teams.status, "active"))),
    db.select({
      id: seasonRegistrations.id,
      seasonId: seasonRegistrations.seasonId,
      primaryPosition: seasonRegistrations.primaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRankSeason: seasonRegistrations.peakRankSeason,
      peakRating: seasonRegistrations.peakRating,
      peakWe: seasonRegistrations.peakWe,
      mapPreferences: seasonRegistrations.mapPreferences,
      highlightVideoUrl: seasonRegistrations.highlightVideoUrl,
      seasonName: seasons.name,
      seasonSlug: seasons.slug,
    }).from(seasonRegistrations)
      .innerJoin(seasons, eq(seasonRegistrations.seasonId, seasons.id))
      .where(and(eq(seasonRegistrations.userId, userId), eq(seasonRegistrations.status, "approved"), ne(seasons.status, "draft")))
      .orderBy(asc(seasons.name), asc(seasonRegistrations.id)),
    db.select().from(competitiveRankFacts).where(eq(competitiveRankFacts.userId, userId)),
    db.select().from(userCompetitiveRoles).where(eq(userCompetitiveRoles.userId, userId)),
    db.select().from(userMapPreferences).where(eq(userMapPreferences.userId, userId)),
    loadCompetitivePlatformCatalog(db),
    db.select({
      id: educationVerifications.id,
      institutionId: educationVerifications.institutionId,
      institutionName: institutions.name,
      academicStatus: educationVerifications.academicStatus,
      status: educationVerifications.status,
      submittedAt: educationVerifications.submittedAt,
    }).from(educationVerifications)
      .innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
      .where(and(eq(educationVerifications.userId, userId), eq(educationVerifications.status, "approved")))
      .orderBy(asc(institutions.name), asc(educationVerifications.institutionId), desc(educationVerifications.submittedAt), asc(educationVerifications.id)),
    getPublicPlayerLft(userId),
    db.select({
      seasonId: competitionEntries.competitionId,
      teamId: competitionEntries.id,
      teamName: competitionEntries.name,
      seasonSlug: seasons.slug,
      seasonName: seasons.name,
      seasonStatus: seasons.status,
    }).from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .innerJoin(competitionEntries, eq(eventRosters.entryId, competitionEntries.id))
      .innerJoin(seasons, eq(competitionEntries.competitionId, seasons.id))
      .where(and(eq(eventRosterMembers.userId, userId), inArray(eventRosters.status, ["confirmed", "frozen"]), ne(seasons.status, "draft"), publicCompetitionEntryCondition()))
      .orderBy(desc(seasons.createdAt), asc(competitionEntries.name), asc(competitionEntries.id)),
    getPublicPlayerRecords(userId),
  ]);
  if (!user) return null;

  const uniqueHistoryEntries = [...new Map(teamMemberRows.map((entry) => [`${entry.seasonId}:${entry.teamId}`, entry])).values()];
  const resultBySeason = new Map<string, Awaited<ReturnType<typeof getPublicSeasonResults>>>();
  const historicalSeasonSlugs = [...new Set(uniqueHistoryEntries.filter((entry) => ["finished", "archived"].includes(entry.seasonStatus)).map((entry) => entry.seasonSlug))];
  await Promise.all(historicalSeasonSlugs.map(async (slug) => {
    const season = await getPublicSeasonBySlug(slug);
    if (season) resultBySeason.set(season.id, await getPublicSeasonResults(season));
  }));

  const careerHistory: PublicPlayerCareerEvent[] = uniqueHistoryEntries
    .filter((entry) => ["finished", "archived"].includes(entry.seasonStatus))
    .map((entry) => {
      const results = resultBySeason.get(entry.seasonId);
      const honorLabels = results?.honors.filter((honor) => honor.entryId === entry.teamId || honor.userId === userId).map((honor) => honor.label) ?? [];
      return {
        seasonId: entry.seasonId,
        seasonSlug: entry.seasonSlug,
        seasonName: entry.seasonName,
        seasonStatus: entry.seasonStatus,
        teamId: entry.teamId,
        teamName: entry.teamName,
        placement: results?.placements.find((placement) => placement.entryId === entry.teamId)?.label ?? null,
        honors: [...new Set(honorLabels)],
        record: careerRecords.get(entry.seasonId) ?? { wins: 0, losses: 0, played: 0 },
      };
    });
  const registrationCompletionRows = registrations.length > 0
    ? await db.select({ seasonId: matches.seasonId, lastCompletedAt: max(matches.completedAt) })
      .from(matches)
      .where(and(inArray(matches.seasonId, [...new Set(registrations.map((registration) => registration.seasonId))]), eq(matches.status, "finished")))
      .groupBy(matches.seasonId)
    : [];
  const completionBySeasonId = new Map(registrationCompletionRows.map((row) => [row.seasonId, row.lastCompletedAt]));
  const registrationSnapshots = [...registrations].sort((left, right) => {
    const leftTime = completionBySeasonId.get(left.seasonId)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = completionBySeasonId.get(right.seasonId)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || left.seasonName.localeCompare(right.seasonName) || left.id.localeCompare(right.id);
  });
  const publicCompetitiveRoles = competitiveRoles
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))
    .map((role) => presentCompetitiveRole(role.role))
    .filter((role): role is string => role !== null);
  const publicEducationIdentities = presentPublicEducationIdentities(educationRows);
  const currentEventTeams = uniqueHistoryEntries.filter((entry) => !["finished", "archived"].includes(entry.seasonStatus));
  const attributePopulation = await attributePopulationPromise;
  const attributes = career.performance
    ? buildPlayerAttributeProfile(career.performance, attributePopulation)
    : null;

  return {
    user,
    career,
    currentTeams,
    eventTeams: uniqueHistoryEntries,
    currentEventTeams,
    careerHistory,
    registrationSnapshots,
    publicCompetitiveProfile: presentPublicCompetitiveProfile(competitiveCatalog, competitiveFacts),
    publicCompetitiveRoles,
    publicEducationIdentities,
    mapPreferences: mapPreferences[0]?.mapPreferences ?? [],
    playerLft,
    attributes,
  };
}

export type PublicPlayerProfileReadModel = NonNullable<Awaited<ReturnType<typeof getPublicPlayerProfileReadModel>>>;
export type PublicPlayerPerformanceEvent = PlayerStatsEventOption;
