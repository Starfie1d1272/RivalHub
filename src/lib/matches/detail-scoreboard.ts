import { assertCompetitionMatch } from "./competition-context";
import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { matchPlayerStats } from "@/db/schema/player-stats";
import type { Match, MatchMap } from "@/db/schema";
import { aggregateFinishedPlayerStats } from "./detail-stats";
import { canConfirmMapScoreboard } from "./map-scoreboard";

export interface MatchScoreboardPlayer {
  userId: string;
  perfectName: string;
  teamId: string;
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
  mapsPlayed: number;
}

/** Public post-map projection. Only operator-confirmed rows from official completed maps participate. */
export async function loadMatchScoreboard(
  match: Match,
  maps: readonly MatchMap[],
  userIdToTeamId: Map<string, string>,
) {
  assertCompetitionMatch(match);
  const completed = maps.filter(canConfirmMapScoreboard);
  if (completed.length === 0) return { completed, confirmedMapIds: new Set<string>(), mapPlayers: new Map<string, MatchScoreboardPlayer[]>(), detailedPlayers: [], detailedPlayerIds: new Set<string>(), detailedMapIds: new Set<string>(), mvpCandidates: [], summaryPlayers: [] };
  const rows = await db.select().from(matchPlayerStats).where(and(
    eq(matchPlayerStats.matchId, match.id),
    inArray(matchPlayerStats.mapId, completed.map((map) => map.id)),
  ));
  const confirmedRows = rows.filter((row) => row.verifiedByAdmin !== null);
  const detailedRows = rows.filter((row) => row.dakImportId && row.userId);
  const mapPlayers = new Map<string, MatchScoreboardPlayer[]>();
  for (const row of confirmedRows) {
    if (!row.userId) continue;
    const teamId = userIdToTeamId.get(row.userId);
    if (teamId !== match.entryAId && teamId !== match.entryBId) continue;
    const players = mapPlayers.get(row.mapId) ?? [];
    players.push({
      userId: row.userId,
      perfectName: row.perfectName,
      teamId,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      hsPercent: row.hsPercent,
      firstKills: row.firstKills,
      multiKills: row.multiKills,
      clutches: row.clutches,
      adr: row.adr,
      rws: row.rws,
      ratingPro: row.ratingPro,
      we: row.we,
      mapsPlayed: 1,
    });
    mapPlayers.set(row.mapId, players);
  }
  const rounds = new Map(completed.map((map) => [map.id, map.scoreA! + map.scoreB!]));
  return { completed, confirmedMapIds: new Set(confirmedRows.map((row) => row.mapId)), mapPlayers, detailedPlayers: [...new Map(detailedRows.map((row) => [row.userId!, { userId: row.userId!, name: row.perfectName }])).values()], detailedPlayerIds: new Set(detailedRows.map((row) => row.userId!)), detailedMapIds: new Set(detailedRows.map((row) => row.mapId)), ...aggregateFinishedPlayerStats(confirmedRows, userIdToTeamId, match.entryAId, match.entryBId, rounds) };
}
