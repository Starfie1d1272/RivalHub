import { officialMatchCondition } from "@/lib/matches/scope";
import "server-only";

import { and, asc, desc, eq, inArray, isNull, max, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, educationVerifications, eventRosterMembers, eventRosters, institutions, matches, seasonRegistrations, seasons, teamMemberships, teams, userCompetitiveRoles, userMapPreferences, competitiveRankFacts } from "@/db/schema";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import type { getPublicPlayerById } from "@/lib/data/public-players";
import { getPublicSeasonBySlug } from "@/lib/data/public-seasons";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import type { PlayerStatsEventOption } from "@/lib/stats/tournament-query";
import { getPublicPlayerCareerDetail } from "@/lib/stats/cached-query";
import { getPlayerAttributeBenchmark } from "@/lib/stats/player-attribute-benchmark";
import { projectPlayerAttributeProfile } from "@/lib/stats/player-attributes";
import { readOptionalPublicStats } from "@/lib/stats/availability";
import { getPublicPlayerRecords } from "./public-record";
import { getPublicCompetitiveCatalog } from "@/lib/competitive/public-catalog";
import { presentCompetitiveRole, presentPublicCompetitiveProfile } from "@/lib/competitive/presentation";
import { presentPublicEducationIdentities } from "@/lib/education/presentation";
import { getPublicPlayerLft } from "@/lib/recruitment/data";
import type { getPublicPlayerSanctions } from "@/lib/discipline/public-query";

export type PublicPlayerCareerEvent = {
  seasonId: string;
  seasonSlug: string;
  seasonName: string;
  seasonStatus: string;
  teamId: string;
  teamName: string;
  placement: string | null;
  honors: string[];
  honorHistory: Array<{ label: string; state: string }>;
  record: { wins: number; losses: number; played: number };
};

type KnownPublicPlayer = {
  user: NonNullable<Awaited<ReturnType<typeof getPublicPlayerById>>>;
  sanctions: Awaited<ReturnType<typeof getPublicPlayerSanctions>>;
};

/** Create once after canonical identity checks; share only within this request. */
export function createPublicPlayerProfileSections(
  { user, sanctions }: KnownPublicPlayer,
  scope: { eventSlug?: string; mapFilter?: string } = {},
) {
  const userId = user.id;
  // Reuse the same cached read for an unfiltered profile; scoped performance
  // and the lifetime header are independent and can load concurrently.
  const lifetimePromise = readOptionalPublicStats("player_career", () => getPublicPlayerCareerDetail({ playerId: userId }));
  const performancePromise = scope.eventSlug || scope.mapFilter
    ? readOptionalPublicStats("player_career", () => getPublicPlayerCareerDetail({ playerId: userId, eventSlug: scope.eventSlug, mapFilter: scope.mapFilter }))
    : lifetimePromise;
  const registrationsPromise = db.select({
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
      .orderBy(asc(seasons.name), asc(seasonRegistrations.id)).execute();
  const teamMemberRowsPromise = db.select({
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
      .where(and(eq(eventRosterMembers.userId, userId), eq(eventRosterMembers.isCurrent, true), inArray(eventRosters.status, ["confirmed", "frozen"]), ne(seasons.status, "draft"), publicCompetitionEntryCondition()))
      .orderBy(desc(seasons.createdAt), asc(competitionEntries.name), asc(competitionEntries.id)).execute()
      .then(rows => [...new Map(rows.map(entry => [`${entry.seasonId}:${entry.teamId}`, entry])).values()]);
  const registrationCompletionPromise = registrationsPromise.then(registrations => registrations.length > 0
    ? db.select({ seasonId: matches.seasonId, lastCompletedAt: max(matches.completedAt) })
      .from(matches)
      .where(and(officialMatchCondition(), and(inArray(matches.seasonId, [...new Set(registrations.map((registration) => registration.seasonId))]), eq(matches.status, "finished"))))
      .groupBy(matches.seasonId)
    : []);
  const resultBySeasonPromise = teamMemberRowsPromise.then(async rows => {
    const resultBySeason = new Map<string, Awaited<ReturnType<typeof getPublicSeasonResults>>>();
    const slugs = [...new Set(rows.filter(entry => ["finished", "archived"].includes(entry.seasonStatus)).map(entry => entry.seasonSlug))];
    for (let offset = 0; offset < slugs.length; offset += 2) {
      await Promise.all(slugs.slice(offset, offset + 2).map(async slug => {
        const season = await getPublicSeasonBySlug(slug);
        if (season) resultBySeason.set(season.id, await getPublicSeasonResults(season));
      }));
    }
    return resultBySeason;
  });
  const basic = Promise.all([
    db.select({ slug: teams.slug, name: teams.name }).from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(and(eq(teamMemberships.userId, userId), isNull(teamMemberships.endedAt), eq(teams.status, "active"))),
    db.select().from(competitiveRankFacts).where(eq(competitiveRankFacts.userId, userId)),
    db.select().from(userCompetitiveRoles).where(eq(userCompetitiveRoles.userId, userId)),
    db.select().from(userMapPreferences).where(eq(userMapPreferences.userId, userId)),
    getPublicCompetitiveCatalog(),
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
    teamMemberRowsPromise,
  ]).then(([currentTeams, competitiveFacts, competitiveRoles, mapPreferences, competitiveCatalog, educationRows, playerLft, teamMemberRows]) => {
    const uniqueHistoryEntries = teamMemberRows;
    return {
      user, sanctions, currentTeams,
      eventTeams: uniqueHistoryEntries,
      currentEventTeams: uniqueHistoryEntries.filter((entry) => !["finished", "archived"].includes(entry.seasonStatus)),
      publicCompetitiveProfile: presentPublicCompetitiveProfile(competitiveCatalog, competitiveFacts),
      publicCompetitiveRoles: competitiveRoles
        .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))
        .map((role) => presentCompetitiveRole(role.role))
        .filter((role): role is string => role !== null),
      publicEducationIdentities: presentPublicEducationIdentities(educationRows),
      mapPreferences: mapPreferences[0]?.mapPreferences ?? [],
      playerLft,
    };
  });
  const history = Promise.all([
    registrationsPromise, teamMemberRowsPromise, getPublicPlayerRecords(userId),
    registrationCompletionPromise, resultBySeasonPromise,
  ]).then(([registrations, teamMemberRows, careerRecords, registrationCompletionRows, resultBySeason]) => {
    const uniqueHistoryEntries = teamMemberRows;

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
          honorHistory: results?.honorHistory.filter((honor) => honor.entryId === entry.teamId || honor.userId === userId).map(({ label, state }) => ({ label, state })) ?? [],
          record: careerRecords.get(entry.seasonId) ?? { wins: 0, losses: 0, played: 0 },
        };
      });
    const completionBySeasonId = new Map(registrationCompletionRows.map((row) => [row.seasonId, row.lastCompletedAt]));
    const registrationSnapshots = [...registrations].sort((left, right) => {
      const leftTime = completionBySeasonId.get(left.seasonId)?.getTime() ?? Number.NEGATIVE_INFINITY;
      const rightTime = completionBySeasonId.get(right.seasonId)?.getTime() ?? Number.NEGATIVE_INFINITY;
      return rightTime - leftTime || left.seasonName.localeCompare(right.seasonName) || left.id.localeCompare(right.id);
    });
    return { careerHistory, registrationSnapshots };
  });
  const overview = lifetimePromise.then(lifetime => ({
    careerOverview: {
      rating: lifetime?.scoreboard[0]?.avgRating ?? null,
      adr: lifetime?.scoreboard[0]?.avgAdr ?? null,
      kd: lifetime?.scoreboard[0]?.kdRatio ?? null,
      maps: lifetime?.summary.maps ?? null,
    },
  }));
  const performance = performancePromise.then(career => ({ career, statsUnavailable: career === null }));
  // Start only when an attribute consumer renders. No private identity is cached.
  let attributesPromise: ReturnType<typeof readAttributes> | undefined;
  async function readAttributes() {
    const career = await performancePromise;
    const benchmark = career?.performance
      ? await readOptionalPublicStats("player_benchmark", getPlayerAttributeBenchmark)
      : null;
    return {
      attributes: career?.performance && benchmark ? projectPlayerAttributeProfile(career.performance, benchmark) : null,
      benchmarkUnavailable: Boolean(career?.performance && !benchmark),
    };
  }
  return { basic, overview, history, performance, attributes: () => attributesPromise ??= readAttributes() };
}

export type PublicPlayerProfileSections = ReturnType<typeof createPublicPlayerProfileSections>;
export type PublicPlayerPerformanceEvent = PlayerStatsEventOption;
