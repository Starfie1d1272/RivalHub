import "server-only";
import { and, eq, inArray, or, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { matchMaps, matches, seasons, userMapPreferences, users } from "@/db/schema";
import { getPublicPlayerMapExperience } from "@/lib/stats/public-query";
import { getPublicDisplayName } from "@/lib/identity/display-name";

type PublicFinishedMatch = {
  id: string;
  stage: string;
  entryAId: string;
  entryBId: string;
};

type PublicFinishedMap = {
  matchId: string;
  mapName: string;
  scoreA: number | null;
  scoreB: number | null;
};

export interface PublicTeamMapPreview {
  playedStages: string[];
  own: Array<{ mapName: string; wins: number; played: number }>;
}

/** Pure aggregation shared by directory previews and full Team profiles. */
export function aggregatePublicTeamMapPreviews(
  entryIds: readonly string[],
  played: readonly PublicFinishedMatch[],
  maps: readonly PublicFinishedMap[],
): Map<string, PublicTeamMapPreview> {
  const result = new Map<string, PublicTeamMapPreview>();
  const mapFactsByMatchId = new Map<string, PublicFinishedMap[]>();
  for (const map of maps) {
    mapFactsByMatchId.set(map.matchId, [...(mapFactsByMatchId.get(map.matchId) ?? []), map]);
  }

  for (const entryId of [...new Set(entryIds)]) {
    const own = new Map<string, { mapName: string; wins: number; played: number }>();
    const teamMatches = played.filter((match) => match.entryAId === entryId || match.entryBId === entryId);
    for (const match of teamMatches) {
      const isA = match.entryAId === entryId;
      for (const map of mapFactsByMatchId.get(match.id) ?? []) {
        if (map.scoreA === null || map.scoreB === null) continue;
        const ownScore = isA ? map.scoreA : map.scoreB;
        const opponentScore = isA ? map.scoreB : map.scoreA;
        const previous = own.get(map.mapName) ?? { mapName: map.mapName, wins: 0, played: 0 };
        own.set(map.mapName, {
          mapName: map.mapName,
          wins: previous.wins + (ownScore > opponentScore ? 1 : 0),
          played: previous.played + 1,
        });
      }
    }
    result.set(entryId, {
      playedStages: [...new Set(teamMatches.map((match) => match.stage))],
      own: [...own.values()].sort((a, b) => b.played - a.played || a.mapName.localeCompare(b.mapName)),
    });
  }
  return result;
}

/** Explicit entry identity owns W/L; current members contribute scouting context only. */
export async function getPublicTeamMapProfile(entryIds: readonly string[], memberIds: readonly string[]) {
  const ids = [...new Set(entryIds)];
  const [played, experience, preferences] = await Promise.all([
    ids.length ? db.select({ id: matches.id, stage: matches.stage, entryAId: matches.entryAId, entryBId: matches.entryBId }).from(matches).innerJoin(seasons, eq(seasons.id, matches.seasonId)).where(and(eq(matches.status, "finished"), ne(seasons.status, "draft"), or(inArray(matches.entryAId, ids), inArray(matches.entryBId, ids)))) : [],
    getPublicPlayerMapExperience(memberIds),
    memberIds.length ? db.select({ userId: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, preferences: userMapPreferences.mapPreferences }).from(userMapPreferences).innerJoin(users, eq(users.id, userMapPreferences.userId)).where(inArray(users.id, [...new Set(memberIds)])) : [],
  ]);
  const matchIds = played.map((match) => match.id);
  const maps = matchIds.length
    ? await db.select({ matchId: matchMaps.matchId, mapName: matchMaps.mapName, scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB }).from(matchMaps).where(inArray(matchMaps.matchId, matchIds))
    : [];
  const previews = aggregatePublicTeamMapPreviews(ids, played, maps);
  const own = new Map<string, { mapName: string; wins: number; played: number }>();
  for (const preview of previews.values()) {
    for (const map of preview.own) {
      const previous = own.get(map.mapName) ?? { mapName: map.mapName, wins: 0, played: 0 };
      own.set(map.mapName, { mapName: map.mapName, wins: previous.wins + map.wins, played: previous.played + map.played });
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
    ? await db.select({ matchId: matchMaps.matchId, mapName: matchMaps.mapName, scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB }).from(matchMaps).where(inArray(matchMaps.matchId, matchIds))
    : [];
  return aggregatePublicTeamMapPreviews(ids, played, maps);
}
