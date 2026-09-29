import type { matchPlayerStats } from "@/db/schema/player-stats";
import { aggregatePlayerRows } from "@/lib/stats/aggregate";
import type { StatRowInput } from "@/lib/stats/aggregate";

export type MatchPlayerStatsRow = typeof matchPlayerStats.$inferSelect;

const TEAM_COLORS = ["#ff6b1a", "#3aa1ff", "#a8ff3a", "#ff3a7a", "#9b6bff", "#ffd23a", "#3affc7", "#ff8a3a"];

export function teamBadgeData(name: string, idx: number): { tag: string; color: string } {
  return { tag: name.slice(0, 3).toUpperCase(), color: TEAM_COLORS[idx % TEAM_COLORS.length] };
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

interface TeamMemberSummary {
  id: string;
  teamId: string;
  personaName: string | null;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
  userId?: string | null;
  avatarUrl: string | null;
}

export interface RosterPlayer {
  registrationPosition?: string;
  personaName: string | null;
  displayName: string | null;
  perfectName: string | null;
  isStarter: boolean;
  userId?: string | null;
  avatarUrl: string | null;
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
      personaName: m.personaName ?? null,
      displayName: m.displayName ?? null,
      perfectName: m.perfectName ?? null,
      ...(m.primaryPosition ? { registrationPosition: m.primaryPosition } : {}),
      isStarter: playerMap.get(m.id) ?? false,
      userId: m.userId ?? null,
      avatarUrl: m.avatarUrl,
    }));
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
