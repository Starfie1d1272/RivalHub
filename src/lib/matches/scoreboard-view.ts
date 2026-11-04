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
}

type BasicScoreboardRow = Pick<MatchStatsRow, "userId" | "perfectName" | "teamId" | "kills" | "deaths" | "assists" | "adr" | "ratingPro">;

/** The reducer owns all rates. This adapter only selects a slice and display fields. */
export function projectMatchStatsRows(identities: readonly MatchScoreboardIdentity[], scoreboard: readonly BasicScoreboardRow[], performance: readonly TournamentPerformancePlayerSummary[], side: MatchStatsSide): MatchStatsRow[] {
  const basicByPlayer = new Map(scoreboard.map(player => [player.userId, player]));
  const performanceByPlayer = new Map(performance.map(player => [player.player.entityKey, player]));
  return identities.map(identity => {
    const basic = basicByPlayer.get(identity.userId);
    const slice = performanceByPlayer.get(identity.userId)?.slices[side];
    const observed = slice && slice.sample.rounds > 0 ? slice : null;
    // A selected side without observed rounds is unknown, never a fabricated zero.
    const fallback = side === "overall" && !slice ? basic : undefined;
    return {
      ...identity,
      kills: observed?.combat.kills ?? fallback?.kills ?? null,
      deaths: observed?.combat.deaths ?? fallback?.deaths ?? null,
      assists: observed?.combat.assists ?? fallback?.assists ?? null,
      adr: observed?.combat.damagePerRound.rate ?? fallback?.adr ?? null,
      headshots: observed?.combat.headshots ?? null,
      flashAssists: observed?.utility.flashAssists ?? null,
      tradedDeaths: observed?.trade.tradedDeaths ?? null,
      firstKills: observed?.opening.firstKills ?? null,
      firstDeaths: observed?.opening.firstDeaths ?? null,
      multiKills: observed ? observed.combat.twoKillRounds + observed.combat.threeKillRounds + observed.combat.fourKillRounds + observed.combat.fiveKillRounds : null,
      clutches: observed?.clutch.wins ?? null,
      kast: observed?.kast.rate ?? null,
      ratingPro: side === "overall" ? basic?.ratingPro ?? null : null,
    };
  });
}

/** Keep the workspace's overall combat sample identical to the main table. */
export function projectMatchWorkspaceScoreboard(
  rows: readonly (import("@/lib/stats/aggregate").StatRowInput & { teamId: string })[],
  performance: TournamentPerformancePlayerSummary | null,
) {
  if (!rows.length && !performance) return [];
  const basic = rows.length ? aggregatePlayerRows([...rows]) : null;
  const slice = performance?.slices.overall;
  const combat = slice && slice.sample.rounds > 0 ? slice.combat : null;
  const stats = combat ? aggregatePlayerRows([{
    userId: performance!.player.entityKey,
    perfectName: performance!.player.displayName,
    kills: combat.kills, deaths: combat.deaths, assists: combat.assists,
    hsPercent: combat.headshotRate.rate === null ? null : combat.headshotRate.rate * 100,
    firstKills: slice!.opening.firstKills,
    multiKills: combat.twoKillRounds + combat.threeKillRounds + combat.fourKillRounds + combat.fiveKillRounds,
    clutches: slice!.clutch.wins, adr: combat.damagePerRound.rate, rounds: slice!.sample.rounds,
    rws: basic?.rws ?? null, ratingPro: basic?.ratingPro ?? null, we: basic?.we ?? null,
  }]) : basic;
  if (!stats) return [];
  const teamId = rows[0]?.teamId ?? performance?.teamEntityKeys[0] ?? null;
  return [{
    teamId, teamIds: teamId ? [teamId] : [], teamName: null,
    perfectName: stats.perfectName, maps: performance?.mapCount ?? stats.maps,
    rounds: stats.totalRounds, avgRating: stats.ratingPro, avgAdr: stats.adr,
    kdRatio: stats.kd, kpr: stats.kpr, avgHs: stats.hsPercent,
    avgWe: stats.we, avgRws: stats.rws, mkpr: stats.mkpr,
  }];
}
