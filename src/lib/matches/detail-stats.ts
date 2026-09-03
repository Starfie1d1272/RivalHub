import type { matchPlayerStats } from "@/db/schema/player-stats";
import type { MapWinStats } from "@/lib/teams/data";
import { avgNums, sumNums } from "@/lib/utils/stats";
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
  const totalKills = sumNums(rows.map((r) => r.kills)) ?? 0;
  const totalDeaths = sumNums(rows.map((r) => r.deaths)) ?? 0;

  // ADR：回合加权（需 mapRoundsMap），无法获取时降级为简单均值
  let avgAdr: number | null;
  if (mapRoundsMap) {
    const totalRounds = rows.reduce((s, r) => s + (mapRoundsMap.get(r.mapId) ?? 0), 0);
    avgAdr =
      totalRounds > 0
        ? rows.reduce((s, r) => s + (r.adr ?? 0) * (mapRoundsMap.get(r.mapId) ?? 0), 0) / totalRounds
        : null;
  } else {
    avgAdr = avgNums(rows.map((r) => r.adr));
  }

  return {
    avgRating: avgNums(rows.map((r) => r.ratingPro)),
    avgAdr,
    avgKd: totalDeaths > 0 ? totalKills / totalDeaths : null,
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
        avgRating: 0,
        avgAdr: 0,
        kdRatio: null,
        avgHs: 0,
        fkpr: 0,
        avgWe: 0,
      };
    }

    const statInputs: StatRowInput[] = playerRows.map((r) => ({
      userId: r.userId,
      perfectName: r.perfectName,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      hsPercent: r.hsPercent,
      firstKills: r.firstKills,
      multiKills: r.multiKills,
      clutches: r.clutches,
      adr: r.adr,
      rws: r.rws,
      ratingPro: r.ratingPro,
      we: r.we,
      rounds: mapRoundsMap.get(r.mapId) ?? 0,
    }));

    const agg = aggregatePlayerRows(statInputs);
    return {
      userId,
      perfectName,
      maps: agg.maps,
      avgRating: agg.ratingPro ?? 0,
      avgAdr: agg.adr ?? 0,
      kdRatio: agg.kd,
      avgHs: agg.hsPercent ?? 0,
      fkpr: agg.fkpr ?? 0,
      avgWe: agg.we ?? 0,
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
    const statInputs: StatRowInput[] = rows.map((r) => ({
      userId: r.userId,
      perfectName: r.perfectName,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      hsPercent: r.hsPercent,
      firstKills: r.firstKills,
      multiKills: r.multiKills,
      clutches: r.clutches,
      adr: r.adr,
      rws: r.rws,
      ratingPro: r.ratingPro,
      we: r.we,
      rounds: mapRoundsMap ? (mapRoundsMap.get(r.mapId) ?? 0) : 0,
    }));
    const agg = aggregatePlayerRows(statInputs);
    return {
      userId: agg.userId,
      perfectName: agg.perfectName,
      kills: agg.kills as number | null,
      deaths: agg.deaths as number | null,
      assists: agg.assists as number | null,
      hsPercent: agg.hsPercent,
      firstKills: agg.firstKills as number | null,
      multiKills: agg.multiKills as number | null,
      clutches: agg.clutches as number | null,
      adr: agg.adr,
      rws: agg.rws,
      ratingPro: agg.ratingPro,
      we: agg.we,
    };
  });

  const mvpCandidates = aggregated
    .sort((a, b) => (b.ratingPro ?? 0) - (a.ratingPro ?? 0))
    .slice(0, 4);

  const summaryPlayers = aggregated
    .map((p) => ({
      ...p,
      teamId: p.userId ? (userIdToTeamId.get(p.userId) ?? "") : "",
      mapsPlayed: groupMap.get(p.userId ?? `name:${p.perfectName}`)?.length ?? 1,
      kills: p.kills ?? 0,
      deaths: p.deaths ?? 0,
      assists: p.assists ?? 0,
      firstKills: p.firstKills ?? 0,
      multiKills: p.multiKills ?? 0,
      clutches: p.clutches ?? 0,
    }))
    .filter((p) => p.teamId === entryAId || p.teamId === entryBId);

  return { mvpCandidates, summaryPlayers };
}
