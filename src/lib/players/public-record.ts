import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { matchRosters, matchRosterPlayers, eventRosterMembers, eventRosters, matches, seasons } from "@/db/schema";

/** A player appearance belongs to the confirmed match roster, not OCR names or today's team. */
export async function getPublicPlayerRecord(userId: string) {
  const appearances = await db.select({ matchId: matches.id, entryId: matchRosters.entryId, entryAId: matches.entryAId, entryBId: matches.entryBId, scoreA: matches.scoreA, scoreB: matches.scoreB })
    .from(matchRosterPlayers).innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .innerJoin(matches, eq(matches.id, matchRosters.matchId)).innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(and(eq(eventRosterMembers.userId, userId), inArray(eventRosters.status, ["confirmed", "frozen"]), eq(matchRosterPlayers.isStarter, true), eq(matchRosters.status, "confirmed"), eq(matches.status, "finished"), ne(seasons.status, "draft")));
  let totalWins = 0;
  let totalLosses = 0;
  for (const match of appearances) {
    if (match.scoreA === null || match.scoreB === null || ![match.entryAId, match.entryBId].includes(match.entryId)) continue;
    const own = match.entryId === match.entryAId ? match.scoreA : match.scoreB;
    const opponent = match.entryId === match.entryAId ? match.scoreB : match.scoreA;
    if (own > opponent) totalWins++;
    if (own < opponent) totalLosses++;
  }
  return { wins: totalWins, losses: totalLosses, played: totalWins + totalLosses };

}
