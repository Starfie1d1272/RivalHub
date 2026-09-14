import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import type { DB, TxDb } from "@/db/client";
import {
  eventRosterMembers,
  matchRosterPlayers,
  matchRosters,
  users,
} from "@/db/schema";

export type MatchRosterExecutor = DB | TxDb;

export interface EffectiveMatchRosterPlayer {
  matchId: string;
  entryId: string;
  rosterId: string;
  eventRosterMemberId: string;
  userId: string;
  steam64: string | null;
  displayName: string | null;
  steamName: string | null;
  perfectName: string | null;
  isStarter: boolean;
}

/**
 * Resolve the lineup consumed by integration read/revision/submit paths.
 * MatchRoster is unique by (matchId, entryId), so both persisted statuses are
 * effective; status remains workflow provenance rather than a read-side gate.
 */
export async function loadEffectiveMatchRoster(
  database: MatchRosterExecutor,
  matchIds: readonly string[],
): Promise<EffectiveMatchRosterPlayer[]> {
  if (matchIds.length === 0) return [];

  return database.select({
    matchId: matchRosters.matchId,
    entryId: matchRosters.entryId,
    rosterId: matchRosters.id,
    eventRosterMemberId: eventRosterMembers.id,
    userId: users.id,
    steam64: users.steam64,
    displayName: users.displayName,
    steamName: users.steamName,
    perfectName: users.perfectName,
    isStarter: matchRosterPlayers.isStarter,
  }).from(matchRosterPlayers)
    .innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .innerJoin(users, eq(users.id, eventRosterMembers.userId))
    .where(and(
      inArray(matchRosters.matchId, [...matchIds]),
      inArray(matchRosters.status, ["submitted", "confirmed"]),
      eq(matchRosterPlayers.isStarter, true),
    ))
    .orderBy(
      asc(matchRosters.matchId),
      asc(matchRosters.entryId),
      asc(matchRosterPlayers.eventRosterMemberId),
    );
}
