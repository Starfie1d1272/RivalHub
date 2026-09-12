import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, users } from "@/db/schema";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getVerifiedPlayerStatsBySeason, type VerifiedPlayerSeasonStats } from "@/lib/stats/public-query";

/** Generic public participant projection for event models with confirmed rosters.
 * Rivals-specific registration snapshots intentionally do not participate here. */
export async function getPublicEventRosterPlayerProjection(seasonId: string): Promise<{
  players: Array<{
    userId: string;
    avatarUrl: string | null;
    entryId: string;
    entryName: string;
    name: string;
    isStarter: boolean;
    stats: VerifiedPlayerSeasonStats | null;
  }>;
  teamCount: number;
}> {
  const rows = await db
    .select({
      userId: users.id,
      avatarUrl: users.avatarUrl,
      displayName: users.displayName,
      perfectName: users.perfectName,
      steamName: users.steamName,
      entryId: competitionEntries.id,
      entryName: competitionEntries.name,
      isStarter: eventRosterMembers.isPrimaryStarter,
    })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
    .innerJoin(users, eq(users.id, eventRosterMembers.userId))
    .where(and(
      eq(competitionEntries.competitionId, seasonId),
      publicCompetitionEntryCondition(),
      inArray(eventRosters.status, ["confirmed", "frozen"]),
    ))
    .orderBy(asc(competitionEntries.name), asc(users.id));
  const statsByUserId = await getVerifiedPlayerStatsBySeason(seasonId, rows.map((row) => row.userId));

  return {
    players: rows.map((row) => ({
      userId: row.userId,
      avatarUrl: row.avatarUrl,
      entryId: row.entryId,
      entryName: row.entryName,
      name: getPublicDisplayName(row),
      isStarter: row.isStarter,
      stats: statsByUserId.get(row.userId) ?? null,
    })),
    teamCount: new Set(rows.map((row) => row.entryId)).size,
  };
}
