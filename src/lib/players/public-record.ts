import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import { matchRosters, matchRosterPlayers, eventRosterMembers, eventRosters, matches, seasons } from "@/db/schema";

type PublicAppearance = { seasonId: string; entryId: string; entryAId: string; entryBId: string; scoreA: number | null; scoreB: number | null };

async function loadPublicAppearances(
  userId: string,
  options: { seasonId?: string; matchIds?: readonly string[] } = {},
  database: DB | TxDb = db,
) {
  if (options.matchIds?.length === 0) return [];
  return database.select({ seasonId: matches.seasonId, entryId: matchRosters.entryId, entryAId: matches.entryAId, entryBId: matches.entryBId, scoreA: matches.scoreA, scoreB: matches.scoreB })
    .from(matchRosterPlayers).innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .innerJoin(matches, eq(matches.id, matchRosters.matchId)).innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(and(eq(eventRosterMembers.userId, userId), inArray(eventRosters.status, ["confirmed", "frozen"]), eq(matchRosterPlayers.isStarter, true), inArray(matchRosters.status, ["submitted", "confirmed"]), eq(matches.status, "finished"), ne(seasons.status, "draft"), options.seasonId ? eq(matches.seasonId, options.seasonId) : undefined, options.matchIds ? inArray(matches.id, [...options.matchIds]) : undefined));
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
  const appearances = await loadPublicAppearances(userId, options, options.database ?? db);
  return summarizeAppearances(appearances);
}

/** Per-event canonical records for the public Player career timeline. */
export async function getPublicPlayerRecords(userId: string, database: DB | TxDb = db) {
  const appearances = await loadPublicAppearances(userId, {}, database);
  const grouped = new Map<string, PublicAppearance[]>();
  for (const row of appearances) {
    const rows = grouped.get(row.seasonId) ?? [];
    rows.push(row);
    grouped.set(row.seasonId, rows);
  }
  return new Map([...grouped].map(([seasonId, rows]) => [seasonId, summarizeAppearances(rows)]));
}
