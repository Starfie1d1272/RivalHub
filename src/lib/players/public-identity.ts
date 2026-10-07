import "server-only";

import { and, eq, exists, inArray, ne, or, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionEntries, competitiveRankFacts, eventRosterMembers, eventRosters, seasonRegistrations, seasons, userCompetitiveRoles, userMapPreferences, users } from "@/db/schema";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";

type Queryable = Pick<TxDb, "select">;

/** Long-lived player identity, independent of the current event or account role. */
export async function getPublicPlayerIdentityIds(executor: Queryable, userIds: readonly string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await executor.select({ userId: users.id }).from(users).where(and(
    eq(users.status, "active"), inArray(users.id, [...new Set(userIds)]),
    or(
      sql`nullif(trim(${users.steam64}), '') is not null`,
      sql`nullif(trim(${users.perfectName}), '') is not null`,
      sql`nullif(trim(${users.gameplayStyle}), '') is not null`,
      sql`nullif(trim(${users.competitionHistory}), '') is not null`,
      exists(executor.select({ id: competitiveRankFacts.id }).from(competitiveRankFacts).where(eq(competitiveRankFacts.userId, users.id))),
      exists(executor.select({ id: userCompetitiveRoles.id }).from(userCompetitiveRoles).where(eq(userCompetitiveRoles.userId, users.id))),
      exists(executor.select({ id: userMapPreferences.userId }).from(userMapPreferences).where(and(eq(userMapPreferences.userId, users.id), sql`jsonb_array_length(${userMapPreferences.mapPreferences}) > 0`))),
      exists(executor.select({ id: seasonRegistrations.id }).from(seasonRegistrations)
        .innerJoin(seasons, eq(seasons.id, seasonRegistrations.seasonId))
        .where(and(eq(seasonRegistrations.userId, users.id), eq(seasonRegistrations.status, "approved"), ne(seasons.status, "draft")))),
      exists(executor.select({ id: eventRosterMembers.id }).from(eventRosterMembers)
        .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
        .innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
        .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
        .where(and(eq(eventRosterMembers.userId, users.id), inArray(eventRosters.status, ["confirmed", "frozen"]), ne(seasons.status, "draft"), publicCompetitionEntryCondition()))),
    ),
  ));
  return new Set(rows.map(row => row.userId));
}
