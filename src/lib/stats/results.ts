export interface TournamentResultMatch {
  id: string;
  entryAId: string;
  entryBId: string;
  scoreA: number | null;
  scoreB: number | null;
  status: string;
}

export interface TournamentResultMap {
  matchId: string;
  mapName: string;
  scoreA: number | null;
  scoreB: number | null;
  completedAt: Date | null;
}

export interface TournamentResultEntry {
  id: string;
  name: string;
}

export function buildTournamentResults(
  matches: readonly TournamentResultMatch[],
  maps: readonly TournamentResultMap[],
  entries: readonly TournamentResultEntry[],
) {
  const completedMaps = maps.filter((map) => map.completedAt !== null && map.scoreA !== null && map.scoreB !== null);
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const completedMatches = matches.filter((match) => match.status === "finished"
    && match.scoreA !== null && match.scoreB !== null);
  const byEntry = new Map(entries.map((entry) => [entry.id, {
    entryId: entry.id,
    name: entry.name,
    matches: 0,
    matchWins: 0,
    matchLosses: 0,
    maps: 0,
    mapWins: 0,
    mapLosses: 0,
  }]));
  const byMapName = new Map<string, number>();
  const teamMapsByName = new Map<string, Map<string, { played: number; wins: number; losses: number }>>();

  for (const match of completedMatches) {
    const teamA = byEntry.get(match.entryAId);
    const teamB = byEntry.get(match.entryBId);
    if (teamA && teamB) {
      teamA.matches += 1;
      teamB.matches += 1;
      if (match.scoreA! > match.scoreB!) {
        teamA.matchWins += 1;
        teamB.matchLosses += 1;
      } else {
        teamB.matchWins += 1;
        teamA.matchLosses += 1;
      }
    }
  }

  for (const map of completedMaps) {
    byMapName.set(map.mapName, (byMapName.get(map.mapName) ?? 0) + 1);
    const match = matchById.get(map.matchId);
    if (!match) continue;
    const teamA = byEntry.get(match.entryAId);
    const teamB = byEntry.get(match.entryBId);
    if (!teamA || !teamB) continue;
    teamA.maps += 1;
    teamB.maps += 1;
    const teamMaps = teamMapsByName.get(map.mapName) ?? new Map<string, { played: number; wins: number; losses: number }>();
    const mapTeamA = teamMaps.get(match.entryAId) ?? { played: 0, wins: 0, losses: 0 };
    const mapTeamB = teamMaps.get(match.entryBId) ?? { played: 0, wins: 0, losses: 0 };
    mapTeamA.played += 1;
    mapTeamB.played += 1;
    if (map.scoreA! > map.scoreB!) {
      teamA.mapWins += 1;
      teamB.mapLosses += 1;
      mapTeamA.wins += 1;
      mapTeamB.losses += 1;
    } else if (map.scoreB! > map.scoreA!) {
      teamB.mapWins += 1;
      teamA.mapLosses += 1;
      mapTeamB.wins += 1;
      mapTeamA.losses += 1;
    }
    teamMaps.set(match.entryAId, mapTeamA);
    teamMaps.set(match.entryBId, mapTeamB);
    teamMapsByName.set(map.mapName, teamMaps);
  }

  const rounds = completedMaps.reduce((sum, map) => sum + map.scoreA! + map.scoreB!, 0);
  return {
    totals: {
      completedMatches: completedMatches.length,
      completedMaps: completedMaps.length,
      completedRounds: rounds,
    },
    teams: [...byEntry.values()].filter((team) => team.matches > 0 || team.maps > 0),
    maps: [...byMapName].map(([mapName, played]) => ({ mapName, played })),
    teamMaps: [...teamMapsByName].map(([mapName, teams]) => ({ mapName, teams: [...teams].map(([entryId, result]) => ({ entryId, ...result })) })),
  };
}
