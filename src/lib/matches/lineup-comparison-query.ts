import { observePublicStatsFill } from "@/lib/stats/public-fill";
import { observeStatsCacheFill, recordStatsCache } from "@/lib/observability/read-budget";
import "server-only";

import { cacheLife } from "next/cache";
import { eq } from "drizzle-orm";
import { lineupPopulationState } from "@/db/schema";
import { db, type DB } from "@/db/client";
import { getLineupStatsPopulation, LINEUP_POPULATION_CHANGED } from "@/lib/stats/leaderboard-query";
import { STATISTICS_PROJECTION_VERSION } from "@/lib/stats/projection-version";
import { CURRENT_DAK_SEMANTIC_PROFILE } from "@/lib/demo-integration/semantic-profile";
import { preservePublicStatsDependencyFailure } from "@/lib/stats/availability";
import { reuseLineupPopulation } from "./lineup-population-cache";
import { partitionRankingPopulation } from "@/lib/stats/ranking";
import type { LineupCareer } from "./lineup-comparison";

/** One population for both lineups and the historical baseline, using current statistics facts. */
export async function loadLineupPopulation(
  excludeMatchId: string | null,
  before: Date,
  database: DB = db,
  revision?: string,
): Promise<LineupCareer[]> {
  const population = await getLineupStatsPopulation(excludeMatchId, before, database, revision);
  const { ranked } = partitionRankingPopulation(
    population,
    (row) => row.avgRating,
    (row) => row.rounds,
  );
  const qualified = new Set(ranked.map((row) => row.userId));
  return population
    .filter((row) => row.userId)
    .map((row) => ({
      userId: row.userId!,
      maps: row.maps,
      rounds: row.rounds,
      qualified: qualified.has(row.userId),
      rating: row.avgRating,
      adr: row.avgAdr,
      kpr: row.kpr,
      kast: row.kast,
      firstKill: row.fkpr,
      trade: row.tradeKpr,
    }));
}

function projectLineupCareers(population: LineupCareer[], playerIds: readonly string[]) {
  const requested = new Set(playerIds);
  return population.filter((row) => requested.has(row.userId));
}

export async function loadLineupCareers(
  playerIds: readonly string[],
  matchId: string,
  before: Date,
  database: DB = db,
): Promise<LineupCareer[]> {
  if (!playerIds.length) return [];
  return projectLineupCareers(await loadLineupPopulation(matchId, before, database), playerIds);
}

// Bump for changes to the corpus, ranking floor, or the serialized read model.
const POPULATION_VERSION = `lineup/1:${STATISTICS_PROJECTION_VERSION}:${CURRENT_DAK_SEMANTIC_PROFILE}`;

async function getLineupPopulation(
  excludeMatchId: string | null,
  cutoff: string | null,
  revision: string,
) {
  "use cache: remote";
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
  const keyFor = (value: string) =>
    JSON.stringify([POPULATION_VERSION, value, cutoff, excludeMatchId]);
  return preservePublicStatsDependencyFailure(() =>
    reuseLineupPopulation(
      keyFor(revision),
      () =>
        observeStatsCacheFill(cutoff ? "lineup.historical" : "lineup.realtime", () =>
          observePublicStatsFill("stats.lineup", () =>
            loadLineupPopulation(
              excludeMatchId,
              cutoff ? new Date(cutoff) : new Date(),
              db,
              revision,
            ),
          ),
        ),
      cutoff
        ? async () => {
            const [state] = await db
              .select({ changes: lineupPopulationState.recentChanges })
              .from(lineupPopulationState)
              .where(eq(lineupPopulationState.revision, revision));
            const keys: string[] = [];
            const before = new Date(cutoff).getTime();
            for (const change of state?.changes ?? []) {
              if (!change.affectedFrom || !(new Date(change.affectedFrom).getTime() >= before))
                break;
              keys.push(keyFor(change.revision));
            }
            return keys;
          }
        : undefined,
    ),
  );
}

export async function getLineupCareers(
  playerIds: string[],
  scope: { matchId: string; cutoff: string | null; revision: string | null; scheduled: boolean },
) {
  if (!playerIds.length) return [];
  const { matchId, cutoff, revision, scheduled } = scope;
  recordStatsCache(cutoff ? "lineup.historical" : "lineup.realtime", "readCalls");
  if (revision) {
    try {
      // The fresh match row and corpus revision come from the same statement.
      const excludeMatchId = !cutoff && scheduled ? null : matchId;
      return projectLineupCareers(
        await getLineupPopulation(excludeMatchId, cutoff, revision),
        playerIds,
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "digest" in error &&
        error.digest === LINEUP_POPULATION_CHANGED
      ))
        throw error;
    }
  }
  // A concurrent commit moved the corpus. Use an exact uncached snapshot for this request.
  return projectLineupCareers(
    await loadLineupPopulation(matchId, cutoff ? new Date(cutoff) : new Date()),
    playerIds,
  );
}
