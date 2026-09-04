import type { matchPlayerStats } from "@/db/schema/player-stats";
import type { MapWinStats } from "@/lib/teams/data";
import { aggregatePlayerRows } from "@/lib/stats/aggregate";
import type { StatRowInput } from "@/lib/stats/aggregate";

export type MatchPlayerStatsRow = typeof matchPlayerStats.$inferSelect;

const TEAM_COLORS = ["#ff6b1a", "#3aa1ff", "#a8ff3a", "#ff3a7a", "#9b6bff", "#ffd23a", "#3affc7", "#ff8a3a"];

export function teamBadgeData(name: string, idx: number): { tag: string; color: string } {
  return { tag: name.slice(0, 3).toUpperCase(), color: TEAM_COLORS[idx % TEAM_COLORS.length] };
}

export function computeRecord(
  teamId: string,
  matchList: { entryAId: string; entryBId: string; scoreA: number | null; scoreB: number | null }[],
): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const m of matchList) {
    const isA = m.entryAId === teamId;
    const myScore = isA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
    const oppScore = isA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
    if (myScore > oppScore) wins++;
    else if (myScore < oppScore) losses++;
  }
  return { wins, losses };
}

export function computeTeamAvgStats(rows: MatchPlayerStatsRow[], mapRoundsMap?: Map<string, number>) {
  if (!rows.length) return { avgRating: null, avgAdr: null, avgKd: null };
  const aggregate = aggregatePlayerRows(rows.map((row) => toStatInput(row, mapRoundsMap?.get(row.mapId) ?? null)));
  return {
    avgRating: aggregate.ratingPro,
    avgAdr: aggregate.adr,
    avgKd: aggregate.kd,
  };
}

function toStatInput(row: MatchPlayerStatsRow, rounds: number | null): StatRowInput {
  return {
    userId: row.userId,
    perfectName: row.perfectName,
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
    rounds,
  };
}

export function buildRadarData(
  mapPool: string[],
  mapWin: Map<string, MapWinStats>,
  pickStats: { pickCount: Map<string, number>; bpMatchCount: number },
  banStats: { banCount: Map<string, number>; bpMatchCount: number },
): Map<string, { winRate: number; pickRate: number; banRate: number }> {
  const data = new Map<string, { winRate: number; pickRate: number; banRate: number }>();
  for (const map of mapPool) {
    const win = mapWin.get(map);
    data.set(map, {
      winRate: win && win.played > 0 ? (win.wins / win.played) * 100 : 0,
      pickRate: pickStats.bpMatchCount > 0 ? ((pickStats.pickCount.get(map) ?? 0) / pickStats.bpMatchCount) * 100 : 0,
      banRate: banStats.bpMatchCount > 0 ? ((banStats.banCount.get(map) ?? 0) / banStats.bpMatchCount) * 100 : 0,
    });
  }
  return data;
}

interface TeamMemberSummary {
  id: string;
  teamId: string;
  steamName: string | null;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
  userId?: string | null;
}

export interface RosterPlayer {
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
  isStarter: boolean;
  userId?: string | null;
}

export function buildRoster(
  roster: { players: { eventRosterMemberId: string; isStarter: boolean }[] },
  members: TeamMemberSummary[],
  teamId: string,
): RosterPlayer[] {
  const playerMap = new Map(roster.players.map((p) => [p.eventRosterMemberId, p.isStarter]));
  const playerIds = new Set(roster.players.map((p) => p.eventRosterMemberId));
  return members
    .filter((m) => m.teamId === teamId && playerIds.has(m.id))
    .map((m) => ({
      steamName: m.steamName ?? "未知",
      displayName: m.displayName ?? null,
      perfectName: m.perfectName ?? null,
      primaryPosition: m.primaryPosition,
      isStarter: playerMap.get(m.id) ?? false,
      userId: m.userId ?? null,
    }));
}

export function buildLineupsPlayers(
  rows: MatchPlayerStatsRow[],
  starterUserIds: string[],
  userIdToMember: Map<string, TeamMemberSummary>,
  mapRoundsMap: Map<string, number>,
) {
  const grouped = new Map<string, MatchPlayerStatsRow[]>();
  for (const r of rows) {
    if (!r.userId) continue;
    const list = grouped.get(r.userId) ?? [];
    list.push(r);
    grouped.set(r.userId, list);
  }
  return starterUserIds.map((userId) => {
    const playerRows = grouped.get(userId) ?? [];
    const member = userIdToMember.get(userId);
    const perfectName =
      playerRows[0]?.perfectName ?? member?.perfectName ?? member?.displayName ?? member?.steamName ?? "未知";

    if (playerRows.length === 0) {
      return {
        userId,
        perfectName,
        maps: 0,
        avgRating: null,
        avgAdr: null,
        kdRatio: null,
        avgHs: null,
        fkpr: null,
        avgWe: null,
      };
    }

    const statInputs: StatRowInput[] = playerRows.map((row) => toStatInput(row, mapRoundsMap.get(row.mapId) ?? null));

    const agg = aggregatePlayerRows(statInputs);
    return {
      userId,
      perfectName,
      maps: agg.maps,
      avgRating: agg.ratingPro,
      avgAdr: agg.adr,
      kdRatio: agg.kd,
      avgHs: agg.hsPercent,
      fkpr: agg.fkpr,
      avgWe: agg.we,
    };
  });
}

export function aggregateFinishedPlayerStats(
  allStats: MatchPlayerStatsRow[],
  userIdToTeamId: Map<string, string>,
  entryAId: string,
  entryBId: string,
  mapRoundsMap?: Map<string, number>,
) {
  const groupMap = new Map<string, MatchPlayerStatsRow[]>();
  for (const s of allStats) {
    const key = s.userId ?? `name:${s.perfectName}`;
    const list = groupMap.get(key) ?? [];
    list.push(s);
    groupMap.set(key, list);
  }

  const aggregated = Array.from(groupMap.values()).map((rows) => {
    const statInputs: StatRowInput[] = rows.map((row) =>
      toStatInput(row, mapRoundsMap?.get(row.mapId) ?? null),
    );
    const agg = aggregatePlayerRows(statInputs);
    return {
      userId: agg.userId,
      perfectName: agg.perfectName,
      kills: agg.kills,
      deaths: agg.deaths,
      assists: agg.assists,
      hsPercent: agg.hsPercent,
      firstKills: agg.firstKills,
      multiKills: agg.multiKills,
      clutches: agg.clutches,
      adr: agg.adr,
      rws: agg.rws,
      ratingPro: agg.ratingPro,
      we: agg.we,
    };
  });

  const mvpCandidates = aggregated
    .sort((a, b) => {
      if (a.ratingPro == null && b.ratingPro == null) return 0;
      if (a.ratingPro == null) return 1;
      if (b.ratingPro == null) return -1;
      return b.ratingPro - a.ratingPro;
    })
    .slice(0, 4);

  const summaryPlayers = aggregated
    .map((p) => ({
      ...p,
      teamId: p.userId ? (userIdToTeamId.get(p.userId) ?? "") : "",
      mapsPlayed: groupMap.get(p.userId ?? `name:${p.perfectName}`)?.length ?? 1,
    }))
    .filter((p) => p.teamId === entryAId || p.teamId === entryBId);

  return { mvpCandidates, summaryPlayers };
}
