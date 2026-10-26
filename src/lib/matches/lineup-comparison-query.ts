import { observePublicStatsFill } from "@/lib/stats/public-fill";
import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { db, type DB } from "@/db/client";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { getCurrentStatsSelectionInTx } from "@/lib/stats/tournament-query";
import { getStatsLeaderboard } from "@/lib/stats/leaderboard-query";
import { partitionRankingPopulation } from "@/lib/stats/ranking";
import type { LineupCareer } from "./lineup-comparison";

/** One metadata selection and one aggregate for both lineups and the historical baseline.
 * No raw Evidence or per-player career/detail queries are read.
 */
export async function loadLineupCareers(playerIds: readonly string[], matchId: string, before: Date, database: DB = db): Promise<LineupCareer[]> {
  if (!playerIds.length) return [];
  return database.transaction(async (tx) => {
    const selection = await getCurrentStatsSelectionInTx(tx, { before, excludeMatchId: matchId });
    const population = await getStatsLeaderboard({}, selection.currentImportIds, selection.roster, tx,
      { groupByTeam: false, requireCurrentImports: true, requireRosterMatch: true });
    const { ranked } = partitionRankingPopulation(population, (row) => row.avgRating, (row) => row.rounds);
    const qualified = new Set(ranked.map((row) => row.userId));
    const requested = new Set(playerIds);
    return population.filter((row) => row.userId && requested.has(row.userId)).map((row) => ({
      userId: row.userId!, maps: row.maps, rounds: row.rounds, qualified: qualified.has(row.userId),
      rating: row.avgRating, adr: row.avgAdr, kpr: row.kpr, kast: row.kast, firstKill: row.fkpr, trade: row.tradeKpr,
    }));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getLineupCareers(playerIds: string[], matchId: string, cutoff: string | null) {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
  return observePublicStatsFill(() => loadLineupCareers(playerIds, matchId, cutoff ? new Date(cutoff) : new Date()));
}
