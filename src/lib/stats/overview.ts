import type { TournamentStats } from "./tournament-query";
import { getDynamicRankingFloor, isRankingEligible, partitionRankingPopulation } from "./ranking";
import { statsRateDenominator, type StatsRateValue } from "./presentation";
import { STATS_METRICS, type StatsMetricKey } from "./metrics";
import { sortStatsRows } from "./sorting";
interface MapLandscapeRow {
  mapName: string;
  played: number;
  rounds: number;
  ct: TournamentStats["analytics"]["maps"][number]["ct"] | null;
  t: TournamentStats["analytics"]["maps"][number]["t"] | null;
  detailed: number;
  completed: number;
}

type TeamAnalyticsRow = TournamentStats["analytics"]["teams"][number];
type EconomyMatrixRow = TournamentStats["analytics"]["economyMatrix"][number];

type SituationHighlight = {
  key: string;
  label: string;
  metric: StatsMetricKey;
  team: TeamAnalyticsRow["team"] | null;
  value: StatsRateValue | null;
};

const FULL_BUY_ORDER = ["eco", "semi", "force"] as const;

function economyVsFullRows(data: TournamentStats): EconomyMatrixRow[] {
  return FULL_BUY_ORDER.flatMap((lowEconomy) => {
    const row = data.analytics.economyMatrix.find((candidate) => candidate.lowEconomy === lowEconomy && candidate.highEconomy === "full");
    return row ? [row] : [];
  });
}

function selectTeamRate<T extends { team: TeamAnalyticsRow["team"] }>(
  teams: readonly T[],
  valueFor: (team: T) => StatsRateValue,
  direction: "asc" | "desc" = "desc",
): { team: TeamAnalyticsRow["team"]; value: StatsRateValue } | null {
  const population = teams.map((row) => ({ team: row.team, value: valueFor(row) }));
  const { ranked } = partitionRankingPopulation(population, (row) => row.value.rate, (row) => statsRateDenominator(row.value));
  return ranked.sort((left, right) =>
      (direction === "asc" ? 1 : -1) * ((left.value.rate ?? 0) - (right.value.rate ?? 0)) ||
      (statsRateDenominator(right.value) ?? 0) - (statsRateDenominator(left.value) ?? 0) ||
      left.team.displayName.localeCompare(right.team.displayName),
    )[0] ?? null;
}

function situationHighlight<T extends { team: TeamAnalyticsRow["team"] }>(
  teams: readonly T[],
  key: string,
  label: string,
  metric: StatsMetricKey,
  valueFor: (team: T) => StatsRateValue,
  direction: "asc" | "desc" = "desc",
): SituationHighlight {
  const selected = selectTeamRate(teams, valueFor, direction);
  return { key, label, metric, team: selected?.team ?? null, value: selected?.value ?? null };
}

function situationHighlights(data: TournamentStats): SituationHighlight[] {
  const teams = data.analytics.teams;
  const performanceTeams = data.performance.teams;
  return [
    situationHighlight(teams, "round-win", "Round Win", "roundWin", (team) => ({ rate: team.roundWinRate, wins: team.roundWins, opportunities: team.rounds })),
    situationHighlight(teams, "r2-conv", STATS_METRICS.conversion.label, "conversion", (team) => team.round2.conversion),
    situationHighlight(teams, "r2-break", "R2 Break", "break", (team) => team.round2.break),
    situationHighlight(teams, "pistol", "Pistol Win", "pistol", (team) => team.pistol),
    situationHighlight(teams, "5v4", "5v4 Conversion · Lowest", "fiveVFour", (team) => team.manAdvantage["5v4"], "asc"),
    situationHighlight(teams, "4v5", "4v5 Comeback", "fourVFive", (team) => team.manAdvantage["4v5"]),
    situationHighlight(performanceTeams, "opening", "Opening Success", "openingWin", (team) => team.slices.overall.opening.successRate),
    situationHighlight(teams, "5v3", "5v3 Conversion · Lowest", "fiveVThree", (team) => team.manAdvantage["5v3"], "asc"),
    situationHighlight(teams, "3v5", "3v5 Comeback", "threeVFive", (team) => team.manAdvantage["3v5"]),
  ];
}

function economyOverall(rows: readonly EconomyMatrixRow[]): { rounds: number; wins: number; rate: number | null } {
  const rounds = rows.reduce((sum, row) => sum + row.rounds, 0);
  const wins = rows.reduce((sum, row) => sum + row.lowEconomyWins, 0);
  return { rounds, wins, rate: rounds > 0 ? wins / rounds : null };
}

function landscapeRows(data: TournamentStats): MapLandscapeRow[] {
  const resultByName = new Map(data.results.maps.map((row) => [row.mapName, row]));
  const analyticsByName = new Map(data.analytics.maps.map((row) => [row.mapName, row]));
  const coverageByName = new Map(data.coverage.maps.map((row) => [row.mapName, row]));
  const names = new Set([
    ...resultByName.keys(),
    ...data.selection.map((row) => row.mapName),
    ...analyticsByName.keys(),
    ...coverageByName.keys(),
  ]);
  return [...names].map((mapName) => {
    const result = resultByName.get(mapName);
    const coverage = coverageByName.get(mapName);
    return {
      mapName,
      played: result?.played ?? 0,
      rounds: result?.rounds ?? 0,
      ct: analyticsByName.get(mapName)?.ct ?? null,
      t: analyticsByName.get(mapName)?.t ?? null,
      detailed: coverage?.detailedMaps ?? 0,
      completed: coverage?.completedMaps ?? result?.played ?? 0,
    };
  });
}

export function buildOverviewReadModel(data: TournamentStats) {
  const ratingFloor = getDynamicRankingFloor(data.leaderboard.map((row) => row.avgRating !== null ? row.rounds : null));
  const rankedPlayers = data.leaderboard.filter((row) => row.avgRating !== null && (!ratingFloor || isRankingEligible(row.rounds, ratingFloor.floor)));
  const topPlayers = sortStatsRows(rankedPlayers, { getValue: (row) => row.avgRating, direction: "desc" }, [
    { getValue: (row) => row.perfectName, direction: "asc" },
    { getValue: (row) => row.userId, direction: "asc" },
  ]).slice(0, 5);
  const teamRatingByEntry = new Map(data.teamRatings.map((row) => [row.entryId, row.rating]));
  const teamRows = data.results.teams.map((row) => ({ ...row, rating: teamRatingByEntry.get(row.entryId) ?? null }));
  const topTeams = sortStatsRows(teamRows, { getValue: (row) => row.rating, direction: "desc" }, [
    { getValue: (row) => row.matchWins, direction: "desc" },
    { getValue: (row) => row.matchLosses, direction: "asc" },
    { getValue: (row) => row.name, direction: "asc" },
  ]).slice(0, 5);
  const topWeapons = sortStatsRows(data.performance.weapons, { getValue: (row) => row.kills, direction: "desc" }, [
    { getValue: (row) => row.weapon, direction: "asc" },
  ]).slice(0, 5);
  return {
    totals: data.results.totals,
    sideSplit: { ct: data.analytics.totals.ct, t: data.analytics.totals.t },
    round2Conversion: data.analytics.totals.round2Conversion,
    coverage: { completedMaps: data.coverage.completedMaps, detailedMaps: data.coverage.detailedMaps },
    teamLinks: data.teamLinks,
    insights: data.insights ?? [],
    topPlayers: topPlayers.map(({ userId, perfectName, avgRating, maps, rounds }) => ({ userId, perfectName, avgRating, maps, rounds })),
    topTeams: topTeams.map(({ entryId, name, rating, matchWins, matchLosses, maps }) => ({ entryId, name, rating, matchWins, matchLosses, maps })),
    topWeapons: topWeapons.map(({ weapon, kills, killShare }) => ({ weapon, kills, killShare })),
    maps: landscapeRows(data),
    economyRows: economyVsFullRows(data),
    overallEconomy: economyOverall(economyVsFullRows(data)),
    highlights: situationHighlights(data),
  };
}
export type OverviewReadModel = ReturnType<typeof buildOverviewReadModel>;
