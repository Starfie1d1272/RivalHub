import { assertCompetitionMatch } from "./competition-context";
import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { matchPlayerStats } from "@/db/schema/player-stats";
import type { Match, MatchMap } from "@/db/schema";
import { aggregateFinishedPlayerStats, selectUnambiguousMatchStatsRows } from "./detail-stats";
import { getMatchPerformance, type MatchPerformance } from "@/lib/stats/match-performance-query";
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
  mapIds: string[];
  isProvisional: boolean;
}

/** Public post-map projection. Only operator-confirmed rows from official completed maps participate. */
export async function loadMatchScoreboard(
  match: Match,
  maps: readonly MatchMap[],
  userIdToTeamId: Map<string, string>,
  performance?: MatchPerformance | null,
  currentImports?: MatchPerformance["currentImports"],
) {
  assertCompetitionMatch(match);
  const completed = maps.filter(map => canConfirmMapScoreboard(map) && map.scoreA! + map.scoreB! > 0);
  if (completed.length === 0) return { completed, confirmedMapIds: new Set<string>(), provisionalMapIds: new Set<string>(), mapPlayers: new Map<string, MatchScoreboardPlayer[]>(), detailedPlayers: [], detailedPlayerIds: new Set<string>(), detailedMapIds: new Set<string>(), mvpCandidates: [], summaryPlayers: [] };
  const rows = await db.select().from(matchPlayerStats).where(and(
    eq(matchPlayerStats.matchId, match.id),
    inArray(matchPlayerStats.mapId, completed.map((map) => map.id)),
  ));
  const detail = performance === undefined ? await getMatchPerformance(match.id) : performance;
  const validImports = currentImports ?? detail?.currentImports;
  const { rows: confirmedRows, conflicts } = selectUnambiguousMatchStatsRows(rows.filter((row) => row.verifiedByAdmin !== null && row.userId !== null
    && userIdToTeamId.has(row.userId)
    && (!row.dakImportId || validImports?.[row.mapId] === row.dakImportId)));
  const detailedPlayers = detail?.overall.map(player => ({ userId: player.player.entityKey, name: player.player.displayName })) ?? [];
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
      mapIds: [row.mapId],
      isProvisional: false,
    });
    mapPlayers.set(row.mapId, players);
  }
  const confirmedMapIds = new Set(confirmedRows.map(row => row.mapId));
  const provisionalMapIds = new Set<string>();
  const importedMapIds = new Set(rows.filter(row => row.dakImportId).map(row => row.mapId));
  for (const map of completed) {
    if (!map.provisionalPlayers?.length || importedMapIds.has(map.id)) continue;
    const existing = mapPlayers.get(map.id) ?? [];
    const confirmedUsers = new Set(existing.map(player => player.userId));
    const provisional = selectUnambiguousMatchStatsRows(map.provisionalPlayers.map(player => ({ ...player, mapId: map.id })));
    const players = provisional.rows.flatMap(player => {
      const teamId = userIdToTeamId.get(player.userId);
      if (confirmedUsers.has(player.userId) || conflicts.has(`${map.id}:${player.userId}`)) return [];
      if (teamId !== match.entryAId && teamId !== match.entryBId) return [];
      return [{ userId: player.userId, perfectName: player.name, teamId, kills: player.kills, deaths: player.deaths, assists: player.assists, hsPercent: null, firstKills: null, multiKills: null, clutches: null, adr: null, rws: null, ratingPro: null, we: null, mapsPlayed: 1, mapIds: [map.id], isProvisional: true }];
    });
    if (players.length) { mapPlayers.set(map.id, [...existing, ...players]); provisionalMapIds.add(map.id); }
  }
  const rounds = new Map(completed.map((map) => [map.id, map.scoreA! + map.scoreB!]));
  return { completed, confirmedMapIds, provisionalMapIds, mapPlayers, detailedPlayers, detailedPlayerIds: new Set(detailedPlayers.map(player => player.userId)), detailedMapIds: new Set(Object.keys(detail?.byMap ?? {})), ...aggregateFinishedPlayerStats(confirmedRows, userIdToTeamId, match.entryAId, match.entryBId, rounds) };
}
