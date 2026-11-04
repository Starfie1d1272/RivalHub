import type { TournamentPerformancePlayerSummary } from "@cs2dak/tournament";
import { aggregatePlayerRows } from "@/lib/stats/aggregate";
import type { MatchStatsSide } from "./stats-view";

export interface MatchScoreboardIdentity { userId: string; perfectName: string; teamId: string }
export interface MatchStatsRow {
  userId: string | null;
  perfectName: string;
  teamId: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  headshots: number | null;
  flashAssists: number | null;
  tradedDeaths: number | null;
  firstKills: number | null;
  firstDeaths: number | null;
  multiKills: number | null;
  clutches: number | null;
  adr: number | null;
  kast: number | null;
  ratingPro: number | null;
  basicCoverage: { maps: number; expectedMaps: number } | null;
  advancedCoverage: { maps: number; expectedMaps: number };
}

type BasicScoreboardRow = Pick<MatchStatsRow, "userId" | "perfectName" | "teamId" | "kills" | "deaths" | "assists" | "adr" | "ratingPro"> & { mapIds: readonly string[] };

function sameUniqueMaps(mapIds: readonly string[], expectedMapIds: readonly string[]) {
  const ids = new Set(mapIds);
  return ids.size === mapIds.length && ids.size === expectedMapIds.length
    && expectedMapIds.every(id => ids.has(id));
}

/** The reducer owns all rates. This adapter only selects a slice and display fields. */
export function projectMatchStatsRows(identities: readonly MatchScoreboardIdentity[], scoreboard: readonly BasicScoreboardRow[], performance: readonly TournamentPerformancePlayerSummary[], side: MatchStatsSide, samples: { expectedMapIds: readonly string[]; performanceMapIdsByPlayer: ReadonlyMap<string, readonly string[]> }): MatchStatsRow[] {
  const basicByPlayer = new Map(scoreboard.map(player => [player.userId, player]));
  const performanceByPlayer = new Map(performance.map(player => [player.player.entityKey, player]));
  return identities.map(identity => {
    const basic = basicByPlayer.get(identity.userId);
    const playerPerformance = performanceByPlayer.get(identity.userId);
    const expectedMaps = samples.expectedMapIds.length;
    const performanceMapIds = samples.performanceMapIdsByPlayer.get(identity.userId) ?? [];
    const slice = playerPerformance?.slices[side];
    const observed = slice && slice.sample.rounds > 0 ? slice : null;
    // Both retains all confirmed scoreboard maps even when advanced coverage is partial.
    // Parenthesized counts must cover that same complete scope, not a smaller DAK sample.
    const matchingDetail = side !== "overall" || (expectedMaps > 0 && basic
      && sameUniqueMaps(basic.mapIds, samples.expectedMapIds)
      && sameUniqueMaps(performanceMapIds, samples.expectedMapIds));
    const detail = matchingDetail ? observed : null;
    return {
      ...identity,
      kills: side === "overall" ? basic?.kills ?? null : observed?.combat.kills ?? null,
      deaths: side === "overall" ? basic?.deaths ?? null : observed?.combat.deaths ?? null,
      assists: side === "overall" ? basic?.assists ?? null : observed?.combat.assists ?? null,
      adr: side === "overall" ? basic?.adr ?? null : observed?.combat.damagePerRound.rate ?? null,
      headshots: detail?.combat.headshots ?? null,
      flashAssists: detail?.utility.flashAssists ?? null,
      tradedDeaths: detail?.trade.tradedDeaths ?? null,
      firstKills: observed?.opening.firstKills ?? null,
      firstDeaths: observed?.opening.firstDeaths ?? null,
      multiKills: observed ? observed.combat.twoKillRounds + observed.combat.threeKillRounds + observed.combat.fourKillRounds + observed.combat.fiveKillRounds : null,
      clutches: observed?.clutch.wins ?? null,
      kast: observed?.kast.rate ?? null,
      ratingPro: side === "overall" ? basic?.ratingPro ?? null : null,
      basicCoverage: side === "overall" ? { maps: new Set(basic?.mapIds ?? []).size, expectedMaps } : null,
      advancedCoverage: { maps: new Set(performanceMapIds).size, expectedMaps },
    };
  });
}

/** The workspace and Both table share the same confirmed scoreboard aggregate. */
export function projectMatchWorkspaceScoreboard(
  rows: readonly (import("@/lib/stats/aggregate").StatRowInput & { teamId: string })[],
) {
  if (!rows.length) return [];
  const stats = aggregatePlayerRows([...rows]);
  const teamId = rows[0].teamId;
  return [{
    teamId, teamIds: [teamId], teamName: null,
    perfectName: stats.perfectName, maps: stats.maps,
    rounds: stats.totalRounds, avgRating: stats.ratingPro, avgAdr: stats.adr,
    kdRatio: stats.kd, kpr: stats.kpr, avgHs: stats.hsPercent,
    avgWe: stats.we, avgRws: stats.rws, mkpr: stats.mkpr,
  }];
}
