import { buildOverviewReadModel } from "./overview";
import type { TournamentStats } from "./tournament-query";
import type { StatsQuery } from "./view-state";

/** No internal record ties, provenance or unused tab collections cross RSC. */
export function publicStatsView(data: TournamentStats, query: StatsQuery) {
  const common: { coverage: TournamentStats["coverage"]; options: TournamentStats["options"]; teamLinks?: Record<string, string> } = { coverage: data.coverage, options: data.options, teamLinks: data.teamLinks };
  switch (query.tab) {
    case "overview": return { ...common, tab: "overview" as const, overview: buildOverviewReadModel(data) };
    case "players": return { ...common, tab: "players" as const, leaderboard: data.leaderboard,
      performance: { players: data.performance.players, teams: data.performance.teams } };
    case "teams": return { ...common, tab: "teams" as const, teamRatings: data.teamRatings,
      analytics: { teams: data.analytics.teams }, performance: { teams: data.performance.teams }, results: { teams: data.results.teams } };
    case "weapons": return { ...common, tab: "weapons" as const, performance: { weapons: data.performance.weapons } };
    case "records": return { ...common, tab: "records" as const, records: data.records, recordEvents: data.recordEvents,
      eventCounts: data.eventCounts, eventMaps: data.eventMaps, recordCoverage: data.recordCoverage };
    case "maps": return { ...common, tab: "maps" as const,
      analytics: { maps: data.analytics.maps }, results: { maps: data.results.maps }, selection: data.selection, veto: data.veto,
      mapDetail: query.map ? { map: query.map, results: data.results, selection: data.selection, coverage: data.coverage,
        analytics: { ...data.analytics, provenance: { semanticProfile: null, analysisVersions: [] }, weapons: [] },
        performance: { ...data.performance, provenance: { semanticProfile: null, analysisVersions: [] }, weapons: [] },
        entries: data.results.teams.map(row => ({ id: row.entryId, name: row.name })) } : undefined };
  }
}
export type PublicStatsData = ReturnType<typeof publicStatsView>;
export type StatsTabData<T extends StatsQuery["tab"]> = Extract<PublicStatsData, { tab: T }>;
