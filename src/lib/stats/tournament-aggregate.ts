import {
  buildTournamentAnalytics,
  buildTournamentPerformanceAnalyticsFromProjections as buildTournamentPerformanceAnalytics,
  scopeTournamentPerformanceMapProjectionToTeam,
} from "@cs2dak/tournament";
import { buildTournamentResults } from "./results";
import type { loadStatsContext } from "./tournament-scope";
import type { loadStatsEvidence, loadStatsDetailEvidence } from "./tournament-projections";
import type { StatsLabels } from "./tournament-query";

type PerformanceEvidenceFacts = Awaited<
  ReturnType<typeof loadStatsEvidence>
>["selected"][number]["facts"]["performance"];

export function scopePerformanceFactsToTeam(
  facts: PerformanceEvidenceFacts,
  teamId: string,
): PerformanceEvidenceFacts {
  return scopeTournamentPerformanceMapProjectionToTeam(facts, teamId);
}

export function performanceFactsForScope(
  loaded: Awaited<ReturnType<typeof loadStatsEvidence>>,
  teamId?: string,
) {
  return loaded.selected.map((row) =>
    teamId ? scopePerformanceFactsToTeam(row.facts.performance, teamId) : row.facts.performance,
  );
}

export function indexStatsRows<T>(rows: readonly T[], key: (row: T) => string) {
  const index = new Map<string, T>();
  for (const row of rows) index.set(key(row), row);
  return index;
}

export function groupEvidenceByMap<T extends { facts: { tournament: { mapName: string } } }>(
  selected: T[],
) {
  const grouped = new Map<string, T[]>();
  for (const row of selected) {
    const mapName = row.facts.tournament.mapName;
    const rows = grouped.get(mapName) ?? [];
    rows.push(row);
    grouped.set(mapName, rows);
  }
  return [...grouped];
}

export function aggregateEvidenceByMap(
  selected: Awaited<ReturnType<typeof loadStatsDetailEvidence>>["selected"],
  labels: StatsLabels,
  options: { indexPlayers?: boolean } = {},
) {
  return groupEvidenceByMap(selected).map(([mapName, rows]) => {
    const analytics = buildTournamentAnalytics(
      rows.map((row) => row.facts.tournament),
      { labels },
    );
    const performance = buildTournamentPerformanceAnalytics(
      rows.map((row) => row.facts.performance),
      { labels },
    );
    return {
      mapName,
      analytics,
      performance,
      analyticsTeams: indexStatsRows(analytics.teams, (row) => row.team.entityKey),
      performanceTeams: indexStatsRows(performance.teams, (row) => row.team.entityKey),
      performancePlayers: options.indexPlayers
        ? indexStatsRows(performance.players, (row) => row.player.entityKey)
        : undefined,
    };
  });
}

export function resultMatchesForMapScope<T extends { id: string }>(
  matches: readonly T[],
  scopedMaps: readonly { matchId: string }[],
  mapFilter?: string,
): T[] {
  if (!mapFilter) return [...matches];
  const scopedMatchIds = new Set(scopedMaps.map((map) => map.matchId));
  return matches.filter((match) => scopedMatchIds.has(match.id));
}

export function buildCoverage(
  loaded: Pick<
    Awaited<ReturnType<typeof loadStatsContext>>,
    "matches" | "scopedMaps" | "entries"
  > & {
    selected: Array<{ facts: { tournament: { mapName: string } } }>;
  },
  results = buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries),
) {
  const detailedByMapName = new Map<string, number>();
  for (const row of loaded.selected)
    detailedByMapName.set(
      row.facts.tournament.mapName,
      (detailedByMapName.get(row.facts.tournament.mapName) ?? 0) + 1,
    );
  return {
    detailedMaps: loaded.selected.length,
    completedMaps: results.totals.completedMaps,
    maps: results.maps.map((row) => ({
      mapName: row.mapName,
      completedMaps: row.played,
      detailedMaps: detailedByMapName.get(row.mapName) ?? 0,
    })),
  };
}
