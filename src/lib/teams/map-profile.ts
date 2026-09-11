import "server-only";
import { and, eq, inArray, or, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { matchMaps, matches, seasons, userMapPreferences, users } from "@/db/schema";
import { getTeamMapWinStats } from "@/lib/teams/data";
import { getPublicPlayerMapExperience } from "@/lib/stats/public-query";
import { getPublicDisplayName } from "@/lib/identity/display-name";

/** Explicit entry identity owns W/L; current members contribute scouting context only. */
export async function getPublicTeamMapProfile(entryIds: readonly string[], memberIds: readonly string[]) {
  const ids = [...new Set(entryIds)];
  const [played, experience, preferences] = await Promise.all([
    ids.length ? db.select({ id: matches.id, stage: matches.stage, entryAId: matches.entryAId, entryBId: matches.entryBId, format: matches.format, scoreA: matches.scoreA, scoreB: matches.scoreB }).from(matches).innerJoin(seasons, eq(seasons.id, matches.seasonId)).where(and(eq(matches.status, "finished"), ne(seasons.status, "draft"), or(inArray(matches.entryAId, ids), inArray(matches.entryBId, ids)))) : [],
    getPublicPlayerMapExperience(memberIds),
    memberIds.length ? db.select({ userId: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, preferences: userMapPreferences.mapPreferences }).from(userMapPreferences).innerJoin(users, eq(users.id, userMapPreferences.userId)).where(inArray(users.id, [...new Set(memberIds)])) : [],
  ]);
  const own = new Map<string, { mapName: string; wins: number; played: number }>();
  for (const id of ids) {
    const maps = await getTeamMapWinStats(id, played.filter((match) => [match.entryAId, match.entryBId].includes(id)));
    for (const [mapName, value] of maps) {
      const previous = own.get(mapName) ?? { mapName, wins: 0, played: 0 };
      own.set(mapName, { mapName, wins: previous.wins + value.wins, played: previous.played + value.played });
    }
  }
  return {
    playedStages: [...new Set(played.map((match) => match.stage))],
    own: [...own.values()].sort((a, b) => b.played - a.played || a.mapName.localeCompare(b.mapName)),
    experience,
    preferences: preferences.map((row) => ({ userId: row.userId, name: getPublicDisplayName(row), preferences: row.preferences })),
  };
}
export type PublicTeamMapProfile = Awaited<ReturnType<typeof getPublicTeamMapProfile>>;

export interface PublicTeamMapPreview {
  playedStages: string[];
  own: Array<{ mapName: string; wins: number; played: number }>;
}

/** Batch map preview for directories: loads all matches and maps in two queries. */
export async function getBatchPublicTeamMapPreviews(
  entryIds: readonly string[],
): Promise<Map<string, PublicTeamMapPreview>> {
  const ids = [...new Set(entryIds)];
  if (!ids.length) return new Map();

  const played = await db
    .select({
      id: matches.id,
      stage: matches.stage,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
    })
    .from(matches)
    .innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(
      and(
        eq(matches.status, "finished"),
        ne(seasons.status, "draft"),
        or(inArray(matches.entryAId, ids), inArray(matches.entryBId, ids)),
      ),
    );

  const matchIds = [...new Set(played.map((m) => m.id))];
  const maps = matchIds.length > 0
    ? await db.query.matchMaps.findMany({
        where: inArray(matchMaps.matchId, matchIds),
      })
    : [];

  const matchById = new Map(played.map((m) => [m.id, m]));
  const result = new Map<string, PublicTeamMapPreview>();

  for (const id of ids) {
    const teamMatches = played.filter((m) => m.entryAId === id || m.entryBId === id);
    const stages = [...new Set(teamMatches.map((m) => m.stage))];
    const teamMatchIds = new Set(teamMatches.map((m) => m.id));
    const teamMaps = maps.filter((mp) => teamMatchIds.has(mp.matchId));

    const own = new Map<string, { mapName: string; wins: number; played: number }>();
    for (const mp of teamMaps) {
      if (mp.scoreA === null || mp.scoreB === null) continue;
      const match = matchById.get(mp.matchId);
      if (!match) continue;
      const isA = match.entryAId === id;
      const myScore = isA ? mp.scoreA : mp.scoreB;
      const oppScore = isA ? mp.scoreB : mp.scoreA;
      const prev = own.get(mp.mapName) ?? { mapName: mp.mapName, wins: 0, played: 0 };
      own.set(mp.mapName, {
        mapName: mp.mapName,
        wins: prev.wins + (myScore > oppScore ? 1 : 0),
        played: prev.played + 1,
      });
    }

    result.set(id, {
      playedStages: stages,
      own: [...own.values()].sort((a, b) => b.played - a.played || a.mapName.localeCompare(b.mapName)),
    });
  }

  return result;
}

