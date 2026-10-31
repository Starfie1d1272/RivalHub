import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import type { DB, TxDb } from "@/db/client";
import type { SelectedFields } from "drizzle-orm/pg-core";
import {
  eventRosterMembers,
  matchRosterPlayers,
  matchRosters,
  steamProfiles,
  users,
} from "@/db/schema";

export type MatchRosterExecutor = DB | TxDb;

export type EffectiveMatchRosterIdentity = Pick<EffectiveMatchRosterPlayer, "matchId" | "entryId" | "eventRosterMemberId" | "userId" | "steam64" | "isStarter">;

export interface EffectiveMatchRosterPlayer {
  matchId: string;
  entryId: string;
  rosterId: string;
  eventRosterMemberId: string;
  userId: string;
  steam64: string | null;
  displayName: string | null;
  personaName: string | null;
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
  includeSubstitutes = false,
): Promise<EffectiveMatchRosterPlayer[]> {
  if (matchIds.length === 0) return [];

  return effectiveMatchRosterQuery(database, matchIds, includeSubstitutes);
}

/** Composable read; projections sharing effective roster rules can remain in one SQL round trip. */
export function effectiveMatchRosterQuery(
  database: MatchRosterExecutor, matchIds: readonly string[], includeSubstitutes = false,
) {
  return rosterQuery(database, matchIds, includeSubstitutes, { rosterId: matchRosters.id, displayName: users.displayName, personaName: steamProfiles.personaName, perfectName: users.perfectName });
}

/** Same effective-lineup rules with the avatar needed by the broadcast manifest. */
export function effectiveMatchRosterWithAvatarQuery(database: MatchRosterExecutor, matchIds: readonly string[]) {
  return rosterQuery(database, matchIds, true, { rosterId: matchRosters.id, displayName: users.displayName, personaName: steamProfiles.personaName, perfectName: users.perfectName, avatarUrl: steamProfiles.avatarUrl });
}

export async function loadEffectiveMatchRosterIdentities(database: MatchRosterExecutor, matchIds: readonly string[]): Promise<EffectiveMatchRosterIdentity[]> {
  if (!matchIds.length) return [];
  return rosterQuery(database, matchIds, false, {});
}

function rosterQuery<T extends SelectedFields>(database: MatchRosterExecutor, matchIds: readonly string[], includeSubstitutes: boolean, extra: T) {
  return database.select({
    matchId: matchRosters.matchId,
    entryId: matchRosters.entryId,
    eventRosterMemberId: eventRosterMembers.id,
    userId: users.id,
    steam64: users.steam64,
    isStarter: matchRosterPlayers.isStarter,
    ...extra,
  }).from(matchRosterPlayers)
    .innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .innerJoin(users, eq(users.id, eventRosterMembers.userId))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(and(
      inArray(matchRosters.matchId, [...matchIds]),
      inArray(matchRosters.status, ["submitted", "confirmed"]),
      ...(includeSubstitutes ? [] : [eq(matchRosterPlayers.isStarter, true)]),
    ))
    .orderBy(
      asc(matchRosters.matchId),
      asc(matchRosters.entryId),
      asc(matchRosterPlayers.eventRosterMemberId),
    );
}
