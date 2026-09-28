import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { eventRosterMembers, eventRosters, matchRosters, matchRosterPlayers, matchPlayerStats, users } from "@/db/schema";

/** MatchRoster members, including substitutes, own identity; legacy matches use current EventRoster only when no lineup exists. */
export async function loadScoreboardPlayers(database: DB | TxDb, matchId: string, entryIds: string[]) {
  const rosters = await database.select({ id: matchRosters.id, entryId: matchRosters.entryId }).from(matchRosters)
    .where(eq(matchRosters.matchId, matchId));
  const players: { userId: string; perfectName: string | null }[] = [];
  for (const entryId of entryIds) {
    const roster = rosters.find(row => row.entryId === entryId);
    if (rosters.length > 0 && !roster) continue;
    const rows = roster
      ? await database.select({ userId: users.id, perfectName: users.perfectName }).from(matchRosterPlayers)
          .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
          .innerJoin(users, eq(users.id, eventRosterMembers.userId))
          .where(eq(matchRosterPlayers.rosterId, roster.id))
      : await database.select({ userId: users.id, perfectName: users.perfectName }).from(eventRosterMembers)
          .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
          .innerJoin(users, eq(users.id, eventRosterMembers.userId))
          .where(and(eq(eventRosters.entryId, entryId), eq(eventRosterMembers.isCurrent, true)));
    players.push(...rows);
  }
  return players;
}

/** Caller locks canonical match/map, just as Demo promotion does. No Demo lineage is changed. */
export async function clearOperatorScoreboardInTx(tx: TxDb, mapId: string) {
  await tx.delete(matchPlayerStats).where(and(eq(matchPlayerStats.mapId, mapId), isNull(matchPlayerStats.dakImportId)));
  await tx.update(matchPlayerStats).set({ ratingPro: null, rws: null, we: null })
    .where(and(eq(matchPlayerStats.mapId, mapId), isNotNull(matchPlayerStats.dakImportId)));
}
