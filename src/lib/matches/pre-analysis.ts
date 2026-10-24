import { withDisplayScores } from "./display-score-data";
import { isCompetitionMatch } from "./competition-context";
import "server-only";

import { db } from "@/db/client";
import type { Match } from "@/db/schema";
import { getTeamBanStats, getTeamMapWinStats, getTeamPickStats } from "@/lib/teams/data";
import { getSeasonFinishedMatches } from "./detail-data";
import { projectRecentMatchResults, type RecentMatchResult } from "./recent-results";

export type MapProfileRate = { count: number; sample: number };
export type MapProfileRow = {
  mapName: string;
  a: { win: MapProfileRate; pick: MapProfileRate; ban: MapProfileRate };
  b: { win: MapProfileRate; pick: MapProfileRate; ban: MapProfileRate };
};

export interface MatchHeadToHeadRow {
  matchId: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  stage: string;
  format: string;
  scoreA: number | null;
  scoreB: number | null;
  teamAWon: boolean;
}

export interface MatchPreAnalysis {
  mapProfileRows: MapProfileRow[];
  recentResultsA: RecentMatchResult[];
  recentResultsB: RecentMatchResult[];
  h2hMatches: MatchHeadToHeadRow[];
  h2hWinsA: number;
  h2hWinsB: number;
}

type MatchWinStats = { wins: number; played: number };
type VetoStats = { count: Map<string, number>; bpMatchCount: number };

export function projectMatchPreAnalysis(input: {
  entryAId: string;
  entryBId: string;
  mapPool: readonly string[];
  matchesA: readonly (Match & { displayScore?: import("./display-score").DisplayScore })[];
  matchesB: readonly (Match & { displayScore?: import("./display-score").DisplayScore })[];
  entryNames: ReadonlyMap<string, string>;
  mapWinsA: ReadonlyMap<string, MatchWinStats>;
  mapWinsB: ReadonlyMap<string, MatchWinStats>;
  picksA: VetoStats;
  picksB: VetoStats;
  bansA: VetoStats;
  bansB: VetoStats;
}): MatchPreAnalysis {
  const mapProfileRows = input.mapPool.map((mapName) => {
    const mapRate = (stats: ReadonlyMap<string, MatchWinStats>): MapProfileRate => {
      const row = stats.get(mapName);
      return { count: row?.wins ?? 0, sample: row?.played ?? 0 };
    };
    const vetoRate = (stats: VetoStats): MapProfileRate => ({
      count: stats.count.get(mapName) ?? 0,
      sample: stats.bpMatchCount,
    });
    return {
      mapName,
      a: { win: mapRate(input.mapWinsA), pick: vetoRate(input.picksA), ban: vetoRate(input.bansA) },
      b: { win: mapRate(input.mapWinsB), pick: vetoRate(input.picksB), ban: vetoRate(input.bansB) },
    };
  });

  const h2hMatches = input.matchesA.filter(isCompetitionMatch)
    .filter((match) => (match.entryAId === input.entryBId || match.entryBId === input.entryBId) && match.scoreA !== null && match.scoreB !== null)
    .sort((a, b) => ((b.completedAt ?? b.scheduledAt)?.getTime() ?? 0) - ((a.completedAt ?? a.scheduledAt)?.getTime() ?? 0))
    .slice(0, 10)
    .map((match) => {
      const teamAIsEntryA = match.entryAId === input.entryAId;
      const display = match.displayScore ?? match;
      const scoreA = teamAIsEntryA ? display.scoreA : display.scoreB;
      const scoreB = teamAIsEntryA ? display.scoreB : display.scoreA;
      return {
        matchId: match.id,
        scheduledAt: match.scheduledAt,
        completedAt: match.completedAt,
        stage: match.stage,
        format: match.format,
        scoreA,
        scoreB,
        teamAWon: teamAIsEntryA ? match.scoreA! > match.scoreB! : match.scoreB! > match.scoreA!,
      };
    });

  return {
    mapProfileRows,
    recentResultsA: projectRecentMatchResults(input.entryAId, input.matchesA, input.entryNames),
    recentResultsB: projectRecentMatchResults(input.entryBId, input.matchesB, input.entryNames),
    h2hMatches,
    h2hWinsA: h2hMatches.filter((match) => match.teamAWon).length,
    h2hWinsB: h2hMatches.filter((match) => !match.teamAWon).length,
  };
}

export async function loadMatchPreAnalysis(
  seasonId: string,
  entryAId: string,
  entryBId: string,
  mapPool: readonly string[],
): Promise<MatchPreAnalysis> {
  const raw = await getSeasonFinishedMatches(seasonId, [entryAId, entryBId]);
  const rawA = raw.filter(match => match.entryAId === entryAId || match.entryBId === entryAId);
  const rawB = raw.filter(match => match.entryAId === entryBId || match.entryBId === entryBId);
  const displayed = await withDisplayScores([...new Map([...rawA, ...rawB].map(match => [match.id, match])).values()]);
  const byId = new Map(displayed.map(match => [match.id, match]));
  const matchesA = rawA.map(match => byId.get(match.id)!);
  const matchesB = rawB.map(match => byId.get(match.id)!);
  const matchIdsA = matchesA.map((match) => match.id);
  const matchIdsB = matchesB.map((match) => match.id);
  const opponentIds = [...new Set([
    ...matchesA.map((match) => match.entryAId === entryAId ? match.entryBId : match.entryAId),
    ...matchesB.map((match) => match.entryAId === entryBId ? match.entryBId : match.entryAId),
  ])];
  const opponentRows = opponentIds.length
    ? await db.query.competitionEntries.findMany({ where: (entries, { inArray }) => inArray(entries.id, opponentIds), columns: { id: true, name: true } })
    : [];
  const entryNames = new Map(opponentRows.map((entry) => [entry.id, entry.name]));
  const [mapWinsA, mapWinsB, picksA, picksB, bansA, bansB] = await Promise.all([
    getTeamMapWinStats(entryAId, matchesA),
    getTeamMapWinStats(entryBId, matchesB),
    getTeamPickStats(entryAId, matchIdsA),
    getTeamPickStats(entryBId, matchIdsB),
    getTeamBanStats(entryAId, matchIdsA),
    getTeamBanStats(entryBId, matchIdsB),
  ]);
  return projectMatchPreAnalysis({
    entryAId,
    entryBId,
    mapPool,
    matchesA,
    matchesB,
    entryNames,
    mapWinsA,
    mapWinsB,
    picksA: { count: picksA.pickCount, bpMatchCount: picksA.bpMatchCount },
    picksB: { count: picksB.pickCount, bpMatchCount: picksB.bpMatchCount },
    bansA: { count: bansA.banCount, bpMatchCount: bansA.bpMatchCount },
    bansB: { count: bansB.banCount, bpMatchCount: bansB.bpMatchCount },
  });
}
