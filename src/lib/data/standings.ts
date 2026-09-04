import "server-only";
import { and, eq, asc, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, matchMaps, competitionEntries } from "@/db/schema";
import { calculateStandings, type MatchRoundScore, type TeamStanding } from "@/lib/standings";

export async function getMatchMapRoundScores(
  matchIds: readonly string[],
): Promise<Map<string, MatchRoundScore[]>> {
  if (matchIds.length === 0) return new Map();

  const rows = await db
    .select({ matchId: matchMaps.matchId, scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB })
    .from(matchMaps)
    .where(and(inArray(matchMaps.matchId, [...matchIds]), isNotNull(matchMaps.scoreA), isNotNull(matchMaps.scoreB)));
  const result = new Map<string, MatchRoundScore[]>();
  for (const row of rows) {
    if (row.scoreA == null || row.scoreB == null) continue;
    const list = result.get(row.matchId) ?? [];
    list.push({ scoreA: row.scoreA, scoreB: row.scoreB });
    result.set(row.matchId, list);
  }
  return result;
}

export async function getStandings(seasonId: string): Promise<TeamStanding[]> {
  const [allTeams, finished] = await Promise.all([
    db.query.competitionEntries.findMany({
      where: eq(competitionEntries.competitionId, seasonId),
      orderBy: [asc(competitionEntries.formationOrder)],
    }),
    db.query.matches.findMany({
      where: and(eq(matches.seasonId, seasonId), eq(matches.status, "finished")),
      orderBy: [asc(matches.createdAt)],
    }),
  ]);

  const roundScores = await getMatchMapRoundScores(finished.map((match) => match.id));
  return calculateStandings(allTeams, finished, roundScores);
}
