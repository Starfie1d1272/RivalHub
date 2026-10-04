import type { TournamentStats } from "./tournament-query";
import type { StatsQuery } from "./view-state";
/** Only aggregated summaries used by the selected view cross the RSC boundary. */
export function publicStatsView(data: TournamentStats, query: StatsQuery): TournamentStats {
  const overview = query.tab === "overview", players = query.tab === "players", teams = query.tab === "teams", maps = query.tab === "maps", weapons = query.tab === "weapons", records = query.tab === "records";
  return { ...data,
    leaderboard: overview || players ? data.leaderboard : [],
    teamRatings: overview || teams ? data.teamRatings : [],
    insights: overview ? data.insights : undefined,
    records: records ? data.records : undefined,
    recordCoverage: records ? data.recordCoverage : undefined,
    analytics: { ...data.analytics, provenance: { semanticProfile: null, analysisVersions: [] },
      teams: overview || teams || (maps && query.map) ? data.analytics.teams : [],
      maps: overview || maps ? data.analytics.maps : [], weapons: [], economyMatrix: overview || (maps && query.map) ? data.analytics.economyMatrix : [] },
    performance: { ...data.performance, provenance: { semanticProfile: null, analysisVersions: [] },
      players: players || (maps && query.map) ? data.performance.players : [],
      teams: overview || players || teams || (maps && query.map) ? data.performance.teams : [],
      maps: overview || (maps && query.map) ? data.performance.maps : [],
      weapons: overview || weapons ? data.performance.weapons : [] },
    results: { ...data.results, teams: overview || teams || (maps && query.map) ? data.results.teams : [],
      maps: overview || maps ? data.results.maps : [], teamMaps: maps ? data.results.teamMaps : [] },
    selection: overview || maps ? data.selection : [],
    veto: { ...data.veto, teams: maps ? data.veto.teams : [] },
  };
}
