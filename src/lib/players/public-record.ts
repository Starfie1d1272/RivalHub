import { officialMatchCondition } from "@/lib/matches/scope";
import { requireCompetitionFields } from "@/lib/matches/competition-context";
import "server-only";
import { and, eq, inArray, ne, or, type SQL } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import { db, type DB, type TxDb } from "@/db/client";
import { cacheLife, cacheTag } from "next/cache";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { matchRosters, matchRosterPlayers, eventRosterMembers, eventRosters, matches, seasons } from "@/db/schema";

type PublicAppearance = { seasonId: string; entryId: string; entryAId: string; entryBId: string; scoreA: number | null; scoreB: number | null };

/** Shared series-appearance scope for records, recent matches and paged history. */
export function publicPlayerAppearancesQuery<T extends SelectedFields>(
  database: DB | TxDb, userId: string, fields: T, filter?: SQL,
) {
  return database.selectDistinct({ ...fields, playerUserId: eventRosterMembers.userId })
    .from(matchRosterPlayers).innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .innerJoin(matches, eq(matches.id, matchRosters.matchId)).innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(and(
      officialMatchCondition(), eq(eventRosterMembers.userId, userId),
      inArray(eventRosters.status, ["confirmed", "frozen"]), eq(matchRosterPlayers.isStarter, true),
      inArray(matchRosters.status, ["submitted", "confirmed"]),
      eq(eventRosters.entryId, matchRosters.entryId),
      or(eq(matchRosters.entryId, matches.entryAId), eq(matchRosters.entryId, matches.entryBId)),
      eq(matches.status, "finished"), ne(seasons.status, "draft"), filter,
    ));
}

async function loadPublicAppearances(
  userId: string,
  options: { seasonId?: string; matchIds?: readonly string[] } = {},
  database: DB | TxDb = db,
) {
  if (options.matchIds?.length === 0) return [];
  return publicPlayerAppearancesQuery(database, userId, {
    matchId: matches.id, seasonId: matches.seasonId, entryId: matchRosters.entryId,
    entryAId: matches.entryAId, entryBId: matches.entryBId, scoreA: matches.scoreA, scoreB: matches.scoreB,
  }, and(options.seasonId ? eq(matches.seasonId, options.seasonId) : undefined,
    options.matchIds ? inArray(matches.id, [...options.matchIds]) : undefined));
}

function summarizeAppearances(appearances: readonly PublicAppearance[]) {
  let wins = 0;
  let losses = 0;
  for (const match of appearances) {
    if (match.scoreA === null || match.scoreB === null || ![match.entryAId, match.entryBId].includes(match.entryId)) continue;
    const own = match.entryId === match.entryAId ? match.scoreA : match.scoreB;
    const opponent = match.entryId === match.entryAId ? match.scoreB : match.scoreA;
    if (own > opponent) wins++;
    if (own < opponent) losses++;
  }
  return { wins, losses, played: wins + losses };
}

/** A player appearance belongs to the effective persisted match roster, not OCR names or today's team. */
export async function getPublicPlayerRecord(
  userId: string,
  options: { seasonId?: string; matchIds?: readonly string[]; database?: DB | TxDb } = {},
) {
  const appearances = (await loadPublicAppearances(userId, options, options.database ?? db)).map(requireCompetitionFields);
  return summarizeAppearances(appearances);
}

/** Per-event canonical records for the public Player career timeline. */
async function loadPublicPlayerRecords(userId: string, database: DB | TxDb = db) {
  const appearances = (await loadPublicAppearances(userId, {}, database)).map(requireCompetitionFields);
  const grouped = new Map<string, PublicAppearance[]>();
  for (const row of appearances) {
    const rows = grouped.get(row.seasonId) ?? [];
    rows.push(row);
    grouped.set(row.seasonId, rows);
  }
  return new Map([...grouped].map(([seasonId, rows]) => [seasonId, summarizeAppearances(rows)]));
}

/** Only public profiles call the default read after their live identity check. */
async function cachedPublicPlayerRecords(userId: string) {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
  return loadPublicPlayerRecords(userId);
}

export async function getPublicPlayerRecords(userId: string, database?: DB | TxDb) {
  return database ? loadPublicPlayerRecords(userId, database) : cachedPublicPlayerRecords(userId);
}
