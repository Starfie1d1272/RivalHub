import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { matchMaps, matches } from "@/db/schema";

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
  const entryIds = profile.entries.map((entry) => entry.id);
  const [mapProfile, careerResults, matchRows] = await Promise.all([
    getPublicTeamMapProfile(
      profile.entries.map((entry) => entry.id),
      profile.currentMembers.map((member) => member.userId),
    ),
    Promise.all([...new Set(profile.entries.filter((entry) => ["finished", "archived"].includes(entry.seasonStatus)).map((entry) => entry.seasonSlug))].map(async (slug) => {
      const season = await getPublicSeasonBySlug(slug);
      return season ? [season.id, await getPublicSeasonResults(season)] as const : null;
    })),
    entryIds.length ? db.select({
      id: matches.id,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
      scoreA: matches.scoreA,
      scoreB: matches.scoreB,
    }).from(matches).where(and(
      eq(matches.status, "finished"),
      or(inArray(matches.entryAId, entryIds), inArray(matches.entryBId, entryIds)),
    )) : Promise.resolve([]),
  ]);
  const mapRows = matchRows.length ? await db.select({
    matchId: matchMaps.matchId,
    mapNumber: matchMaps.mapNumber,
    winnerEntryId: matchMaps.winnerEntryId,
  }).from(matchMaps).where(inArray(matchMaps.matchId, matchRows.map((match) => match.id))) : [];
  const mapsByMatch = new Map<string, typeof mapRows>();
  for (const map of mapRows) mapsByMatch.set(map.matchId, [...(mapsByMatch.get(map.matchId) ?? []), map]);
  const profileEntryRecords = new Map(profile.entries.map((entry) => [entry.id, { wins: 0, losses: 0, mapWins: 0, mapLosses: 0, maps: 0 }]));
  for (const match of matchRows) {
    const entryId = entryIds.includes(match.entryAId) ? match.entryAId : entryIds.includes(match.entryBId) ? match.entryBId : null;
    if (!entryId) continue;
    const record = profileEntryRecords.get(entryId)!;
    const ownScore = entryId === match.entryAId ? match.scoreA : match.scoreB;
    const opponentScore = entryId === match.entryAId ? match.scoreB : match.scoreA;
    if (ownScore !== null && opponentScore !== null) {
      if (ownScore > opponentScore) record.wins += 1;
      else if (ownScore < opponentScore) record.losses += 1;
    }
    for (const map of mapsByMatch.get(match.id) ?? []) {
      record.maps += 1;
      if (map.scoreA === null || map.scoreB === null || map.scoreA === map.scoreB) continue;
      const ownMapScore = entryId === match.entryAId ? map.scoreA : map.scoreB;
      const opponentMapScore = entryId === match.entryAId ? map.scoreB : map.scoreA;
      if (ownMapScore > opponentMapScore) record.mapWins += 1;
      else record.mapLosses += 1;
    }
  }
  const resultBySeason = new Map(careerResults.filter((row): row is NonNullable<typeof row> => row !== null));

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
        matchWins: profileEntryRecords.get(entry.id)?.wins ?? 0,
        matchLosses: profileEntryRecords.get(entry.id)?.losses ?? 0,
        mapWins: profileEntryRecords.get(entry.id)?.mapWins ?? 0,
        mapLosses: profileEntryRecords.get(entry.id)?.mapLosses ?? 0,
        maps: profileEntryRecords.get(entry.id)?.maps ?? 0,
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
