import "server-only";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
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

/**
 * Operator-editor cells only. The editor needs the gameplay numbers to display
 * them and the ownership flag to know which cells DAK already owns; it never
 * needs import lineage, the verifying actor or raw persistence columns.
 */
export interface OperatorScoreboardRow {
  perfectName: string;
  userId: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  hsPercent: number | null;
  firstKills: number | null;
  multiKills: number | null;
  clutches: number | null;
  adr: number | null;
  rws: number | null;
  ratingPro: number | null;
  we: number | null;
  /** True when DAK owns the gameplay facts, so the editor may only correct Rating / RWS / WE. */
  gameplayLocked: boolean;
}

/**
 * Server-only read model for the operator scoreboard editor. Selecting explicit
 * fields keeps DAK lineage (dakImportId), the verification actor/time and other
 * internal columns out of anything that can reach a browser.
 */
export async function loadOperatorScoreboard(database: DB | TxDb, mapId: string): Promise<OperatorScoreboardRow[]> {
  const rows = await database
    .select({
      perfectName: matchPlayerStats.perfectName,
      userId: matchPlayerStats.userId,
      kills: matchPlayerStats.kills,
      deaths: matchPlayerStats.deaths,
      assists: matchPlayerStats.assists,
      hsPercent: matchPlayerStats.hsPercent,
      firstKills: matchPlayerStats.firstKills,
      multiKills: matchPlayerStats.multiKills,
      clutches: matchPlayerStats.clutches,
      adr: matchPlayerStats.adr,
      rws: matchPlayerStats.rws,
      ratingPro: matchPlayerStats.ratingPro,
      we: matchPlayerStats.we,
      dakImportId: matchPlayerStats.dakImportId,
    })
    .from(matchPlayerStats)
    .where(eq(matchPlayerStats.mapId, mapId))
    .orderBy(desc(matchPlayerStats.ratingPro));
  return rows.map(({ dakImportId, ...row }) => ({ ...row, gameplayLocked: dakImportId !== null }));
}
