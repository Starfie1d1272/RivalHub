import type { TournamentAnalytics, TournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { friendlyBlindPerFlash, openingDeathTraded } from "./derived-metrics";
import { buildInsights, type InsightEntity, type InsightFact } from "./insights";
import type { StatsRateValue } from "./presentation";
import { statsRateDenominator, statsRateNumerator } from "./presentation";

export function buildScopeInsights(analytics: TournamentAnalytics, performance: TournamentPerformanceAnalytics,
  perMap: { mapKey: string; performance: TournamentPerformanceAnalytics }[], teamLinks: Record<string, string>, scope: string) {
  const fact = (value: StatsRateValue, coverage: string, kind: InsightFact["kind"] = "probability"): InsightFact | undefined => {
    const x = statsRateNumerator(value), n = statsRateDenominator(value);
    return x === undefined || n === undefined ? undefined : { kind, x, n, value: value.rate, coverage };
  };
  const teamMaps = (key: string) => perMap.filter((m) => m.performance.teams.some((t) => t.team.entityKey === key)).map((m) => m.mapKey).sort().join(",");
  const entities: InsightEntity[] = analytics.teams.map((row) => {
    const coverage = teamMaps(row.team.entityKey);
    return { key: `team:${row.team.entityKey}`, name: row.team.displayName, href: teamLinks[row.team.entityKey] ?? "/teams", type: "team",
      metrics: { fourVFive: fact(row.manAdvantage["4v5"], coverage), fiveVFour: fact(row.manAdvantage["5v4"], coverage), pistol: fact(row.pistol, coverage), conversion: fact(row.round2.conversion, coverage), break: fact(row.round2.break, coverage) } };
  });
  for (const row of performance.players) {
    const maps = perMap.flatMap((m) => {
      const player = m.performance.players.find((p) => p.player.entityKey === row.player.entityKey);
      return player ? [{ mapKey: m.mapKey, enemy: player.slices.overall.utility.enemyBlindSeconds, friendly: player.slices.overall.utility.teamBlindSeconds, flashes: player.slices.overall.utility.flashesThrown }] : [];
    });
    const coverage = maps.map((m) => m.mapKey).sort().join(","), slice = row.slices.overall;
    entities.push({ key: `player:${row.player.entityKey}`, name: row.player.displayName, href: `/players/${row.player.entityKey}`, type: "player", flashMaps: maps,
      metrics: { winAfterOpeningLoss: fact(slice.opening.comebackRateAfterLosingOpeningDuel, coverage), openingDeathTradedRate: fact(openingDeathTraded(slice), coverage),
        blindPerFlash: fact(slice.utility.enemyBlindSecondsPerFlash, coverage, "amountPerUnit"), netBlindPerFlash: fact(slice.utility.netBlindSecondsPerFlash, coverage, "amountPerUnit"), friendlyBlindPerFlash: fact(friendlyBlindPerFlash(slice), coverage, "amountPerUnit") } });
  }
  return buildInsights(entities, scope);
}
