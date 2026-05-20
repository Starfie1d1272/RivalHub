import type { matchPlayerStats } from "@/db/schema/player-stats";
import type { MapWinStats } from "@/lib/teams/data";
import { avgNums, sumNums, weightedAvgNums } from "@/lib/utils/stats";

export type MatchPlayerStatsRow = typeof matchPlayerStats.$inferSelect;

export const TEAM_COLORS = ["#ff6b1a", "#3aa1ff", "#a8ff3a", "#ff3a7a", "#9b6bff", "#ffd23a", "#3affc7", "#ff8a3a"];

export function teamBadgeData(name: string, idx: number): { tag: string; color: string } {
  return { tag: name.slice(0, 3).toUpperCase(), color: TEAM_COLORS[idx % TEAM_COLORS.length] };
}

export function computeRecord(
  teamId: string,
  matchList: { teamAId: string; teamBId: string; scoreA: number | null; scoreB: number | null }[],
): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const m of matchList) {
    const isA = m.teamAId === teamId;
    const myScore = isA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
    const oppScore = isA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
    if (myScore > oppScore) wins++;
    else if (myScore < oppScore) losses++;
  }
  return { wins, losses };
}

export function computeTeamAvgStats(rows: MatchPlayerStatsRow[]) {
  if (!rows.length) return { avgRating: null, avgAdr: null, avgKd: null };
  const totalKills = sumNums(rows.map((r) => r.kills)) ?? 0;
  const totalDeaths = sumNums(rows.map((r) => r.deaths)) ?? 0;
  return {
    avgRating: avgNums(rows.map((r) => r.ratingPro)),
    avgAdr: avgNums(rows.map((r) => r.adr)),
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
  roster: { players: { teamMemberId: string; isStarter: boolean }[] },
  members: TeamMemberSummary[],
  teamId: string,
): RosterPlayer[] {
  const playerMap = new Map(roster.players.map((p) => [p.teamMemberId, p.isStarter]));
  const playerIds = new Set(roster.players.map((p) => p.teamMemberId));
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
  matchRoundsMap: Map<string, number>,
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
    const totalKills = sumNums(playerRows.map((r) => r.kills)) ?? 0;
    const totalDeaths = sumNums(playerRows.map((r) => r.deaths)) ?? 0;
    const firstKills = sumNums(playerRows.map((r) => r.firstKills)) ?? 0;
    const totalRounds = sumNums(playerRows.map((r) => matchRoundsMap.get(r.matchId) ?? 0)) ?? 0;
    return {
      userId,
      perfectName,
      maps: playerRows.length,
      avgRating: avgNums(playerRows.map((r) => r.ratingPro)) ?? 0,
      avgAdr: avgNums(playerRows.map((r) => r.adr)) ?? 0,
      kdRatio: totalDeaths > 0 ? totalKills / totalDeaths : null,
      avgHs: avgNums(playerRows.map((r) => r.hsPercent)) ?? 0,
      fkpr: totalRounds > 0 ? firstKills / totalRounds : 0,
      avgWe: avgNums(playerRows.map((r) => r.we)) ?? 0,
    };
  });
}

export function aggregateFinishedPlayerStats(
  allStats: MatchPlayerStatsRow[],
  userIdToTeamId: Map<string, string>,
  teamAId: string,
  teamBId: string,
) {
  const groupMap = new Map<string, MatchPlayerStatsRow[]>();
  for (const s of allStats) {
    const key = s.userId ?? `name:${s.perfectName}`;
    const list = groupMap.get(key) ?? [];
    list.push(s);
    groupMap.set(key, list);
  }

  const aggregated = Array.from(groupMap.values()).map((rows) => ({
    userId: rows[0].userId,
    perfectName: rows[0].perfectName,
    kills: sumNums(rows.map((r) => r.kills)),
    deaths: sumNums(rows.map((r) => r.deaths)),
    assists: sumNums(rows.map((r) => r.assists)),
    hsPercent: weightedAvgNums(rows.map((r) => r.hsPercent), rows.map((r) => r.kills)),
    firstKills: sumNums(rows.map((r) => r.firstKills)),
    multiKills: sumNums(rows.map((r) => r.multiKills)),
    clutches: sumNums(rows.map((r) => r.clutches)),
    adr: avgNums(rows.map((r) => r.adr)),
    rws: avgNums(rows.map((r) => r.rws)),
    ratingPro: avgNums(rows.map((r) => r.ratingPro)),
    we: avgNums(rows.map((r) => r.we)),
  }));

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
    .filter((p) => p.teamId === teamAId || p.teamId === teamBId);

  return { mvpCandidates, summaryPlayers };
}
