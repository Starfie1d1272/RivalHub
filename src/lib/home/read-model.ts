import { getPublicCaptainVotingData } from "@/lib/captains/data";
import { officialMatchCondition } from "@/lib/matches/scope";
import "server-only";

import { alias } from "drizzle-orm/pg-core";
import { and, count, eq, or, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db } from "@/db/client";
import { competitionEntries, seasonRegistrations, users } from "@/db/schema";
import { matches } from "@/db/schema/matches";
import { PUBLIC_HOME_TAG } from "@/lib/cache/tags";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { getMajorPublicParticipantOverview } from "@/lib/major/public-participants";
import { getParticipantSummary } from "@/lib/participants/summary";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import { groupSeasonsByLifecycle } from "@/lib/seasons/presentation";
import { getPublicSeasonResults, type PublicSeasonResults } from "@/lib/seasons/public-results";
import { selectFeaturedSeason } from "@/lib/home/navigation";
import { shouldLoadRegistrationPositionCounts } from "@/lib/home/presentation";
import type { PublicSeasonWithCompletion } from "@/lib/data/public-seasons";

export interface PublicHomeProjection {
  featured: PublicSeasonWithCompletion | null;
  otherSeasons: PublicSeasonWithCompletion[];
  archivedSeasons: PublicSeasonWithCompletion[];
  results: PublicSeasonResults | null;
  maxPerPosition: number;
  positionCounts: Record<string, number>;
  topCandidatesWithNames: Array<{ userId: string; name: string; voteCount: number }>;
  liveAndUpcomingMatches: Array<{
    id: string;
    entryAId: string | null;
    entryBId: string | null;
    status: string;
    scheduledAt: Date | null;
    format: string;
    teamAName: string | null;
    teamBName: string | null;
  }>;
  teamCount: number;
  playerCount: number;
}

export async function getPublicHomeProjection(
  allSeasons: PublicSeasonWithCompletion[],
): Promise<PublicHomeProjection> {
  "use cache: remote";
  cacheLife("minutes");
  cacheTag(PUBLIC_HOME_TAG);

  const featured = selectFeaturedSeason(allSeasons) ?? null;
  const otherSeasons = featured
    ? allSeasons.filter((season) => !["finished", "archived"].includes(season.status) && season.id !== featured.id)
    : [];
  const historicalSeasons = groupSeasonsByLifecycle(allSeasons);
  const archivedSeasons = featured
    ? [...historicalSeasons.recent, ...historicalSeasons.archived]
        .filter((season) => season.id !== featured.id)
        .sort((a, b) => {
          const completedDifference = (b.lastCompletedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
            - (a.lastCompletedAt?.getTime() ?? Number.NEGATIVE_INFINITY);
          return completedDifference || a.id.localeCompare(b.id);
        })
        .slice(0, 6)
    : [];

  if (!featured) {
    return {
      featured: null,
      otherSeasons,
      archivedSeasons,
      results: null,
      maxPerPosition: 0,
      positionCounts: {},
      topCandidatesWithNames: [],
      liveAndUpcomingMatches: [],
      teamCount: 0,
      playerCount: 0,
    };
  }

  const opponentEntry = alias(competitionEntries, "home_opponent");
  const [majorOverview, [featuredTeamCount], participantSummary, registrationCounts, topCandidates, liveAndUpcomingMatches] =
    await Promise.all([
      featured.competitionTemplate === "major" ? getMajorPublicParticipantOverview(featured) : Promise.resolve(null),
      featured.competitionTemplate === "major"
        ? Promise.resolve([] as { value: number }[])
        : db.select({ value: count() }).from(competitionEntries)
            .where(and(eq(competitionEntries.competitionId, featured.id), publicCompetitionEntryCondition())),
      featured.competitionTemplate === "major"
        ? Promise.resolve({ count: 0, hasPlayers: false })
        : getParticipantSummary(featured),
      shouldLoadRegistrationPositionCounts(featured)
        ? db.select({ position: seasonRegistrations.primaryPosition, cnt: count() })
            .from(seasonRegistrations)
            .innerJoin(users, and(eq(seasonRegistrations.userId, users.id), eq(users.status, "active")))
            .where(and(
              eq(seasonRegistrations.seasonId, featured.id),
              eq(users.status, "active"),
              or(eq(seasonRegistrations.status, "approved"), eq(seasonRegistrations.status, "pending")),
            ))
            .groupBy(seasonRegistrations.primaryPosition)
        : Promise.resolve([] as { position: string; cnt: number }[]),
      featured.status === "voting"
        ? getPublicCaptainVotingData(featured.id).then(data => data.candidates.slice(0, 3).map(candidate => ({ userId: candidate.userId, name: candidate.displayName, voteCount: candidate.voteCount })))
        : Promise.resolve([] as { userId: string; name: string; voteCount: number }[]),
      featured.hasOfficialMatches
        ? db.select({
            id: matches.id,
            entryAId: matches.entryAId,
            entryBId: matches.entryBId,
            status: matches.status,
            scheduledAt: matches.scheduledAt,
            format: matches.format,
            teamAName: competitionEntries.name,
            teamBName: opponentEntry.name,
          })
            .from(matches)
            .leftJoin(competitionEntries, eq(competitionEntries.id, matches.entryAId))
            .leftJoin(opponentEntry, eq(opponentEntry.id, matches.entryBId))
            .where(and(officialMatchCondition(), and(
              eq(matches.seasonId, featured.id),
              or(eq(matches.status, "in_progress"), eq(matches.status, "scheduled")),
            )))
            .orderBy(sql`case when ${matches.status} = 'in_progress' then 0 when ${matches.scheduledAt} is not null then 1 else 2 end`, matches.scheduledAt)
            .limit(2)
        : Promise.resolve([] as {
            id: string;
            entryAId: string | null;
            entryBId: string | null;
            status: string;
            scheduledAt: Date | null;
            format: string;
            teamAName: string | null;
            teamBName: string | null;
          }[]),
    ]);

  const results = ["finished", "archived"].includes(featured.status)
    ? await getPublicSeasonResults(featured)
    : null;
  const registrationConfig = normalizeRegistrationConfig(featured.registrationConfig);

  return {
    featured,
    otherSeasons,
    archivedSeasons,
    results,
    maxPerPosition: registrationConfig.maxPerPosition,
    positionCounts: Object.fromEntries(registrationCounts.map((row) => [row.position, Number(row.cnt)])),
    topCandidatesWithNames: topCandidates,
    liveAndUpcomingMatches,
    teamCount: majorOverview?.teamCount ?? Number(featuredTeamCount?.value ?? 0),
    playerCount: majorOverview?.playerCount ?? participantSummary.count,
  };
}
