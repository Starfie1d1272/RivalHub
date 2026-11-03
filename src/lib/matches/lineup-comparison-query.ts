import { observePublicStatsFill } from "@/lib/stats/public-fill";
import { observeStatsCacheFill, recordStatsCache } from "@/lib/observability/read-budget";
import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { db, type DB } from "@/db/client";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { getCurrentStatsSelectionInTx } from "@/lib/stats/tournament-query";
import { getLineupStatsPopulation } from "@/lib/stats/leaderboard-query";
import { partitionRankingPopulation } from "@/lib/stats/ranking";
import { fingerprintLineupInputs } from "./lineup-population-fingerprint";
import type { LineupCareer } from "./lineup-comparison";

// Internal process cache is bounded and scoped to this deployed module. Remote
// cache semantics remain unchanged; only a remote fill consults this cache.
const populations = new Map<string, { value: LineupCareer[]; bytes: number }>();
const MAX_ENTRIES = 32;
const MAX_BYTES = 4 * 1024 * 1024;
let retainedBytes = 0;
class FingerprintUnavailable extends Error {}

async function readPopulation(matchId: string, before: Date, database: DB, useContentCache: boolean): Promise<LineupCareer[]> {
  return database.transaction(async (tx) => {
    let key: string | undefined;
    if (useContentCache) {
      try { key = await fingerprintLineupInputs(tx, matchId, before); }
      catch { throw new FingerprintUnavailable(); }
    }
    if (key) {
      const cached = populations.get(key);
      if (cached) {
        populations.delete(key);
        populations.set(key, cached);
        return cached.value;
      }
    }
    const selection = await getCurrentStatsSelectionInTx(tx, { before, excludeMatchId: matchId });
    const population = await getLineupStatsPopulation(selection.currentImportIds, selection.roster, tx);
    const { ranked } = partitionRankingPopulation(population, (row) => row.avgRating, (row) => row.rounds);
    const qualified = new Set(ranked.map((row) => row.userId));
    const result = population.filter((row) => row.userId).map((row) => ({
      userId: row.userId!, maps: row.maps, rounds: row.rounds, qualified: qualified.has(row.userId),
      rating: row.avgRating, adr: row.avgAdr, kpr: row.kpr, kast: row.kast, firstKill: row.fkpr, trade: row.tradeKpr,
    }));
    if (key) {
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes <= MAX_BYTES) {
        const previous = populations.get(key);
        if (previous) retainedBytes -= previous.bytes;
        populations.delete(key);
        populations.set(key, { value: result, bytes });
        retainedBytes += bytes;
        while (populations.size > MAX_ENTRIES || retainedBytes > MAX_BYTES) {
          const oldest = populations.keys().next().value!;
          retainedBytes -= populations.get(oldest)!.bytes;
          populations.delete(oldest);
        }
      }
    }
    return result;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** The explicit DB entry point remains uncached for isolated callers and tests. */
export async function loadLineupPopulation(matchId: string, before: Date, database: DB = db): Promise<LineupCareer[]> {
  return readPopulation(matchId, before, database, false);
}

async function loadCachedLineupPopulation(matchId: string, before: Date) {
  try { return await readPopulation(matchId, before, db, true); }
  catch (error) {
    if (!(error instanceof FingerprintUnavailable)) throw error;
    // A failed SQL statement aborts its transaction; reselect in a new snapshot.
    return readPopulation(matchId, before, db, false);
  }
}

function projectLineupCareers(population: LineupCareer[], playerIds: readonly string[]) {
  const requested = new Set(playerIds);
  return population.filter(row => requested.has(row.userId));
}

export async function loadLineupCareers(playerIds: readonly string[], matchId: string, before: Date, database: DB = db): Promise<LineupCareer[]> {
  if (!playerIds.length) return [];
  return projectLineupCareers(await loadLineupPopulation(matchId, before, database), playerIds);
}

async function getLineupPopulation(matchId: string, cutoff: string | null) {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife(cutoff
    ? { stale: 60, revalidate: 3600, expire: 86400 }
    : { stale: 60, revalidate: 60, expire: 3600 });
  return observeStatsCacheFill(cutoff ? "lineup.historical" : "lineup.realtime", () => observePublicStatsFill("stats.lineup", () => loadCachedLineupPopulation(matchId, cutoff ? new Date(cutoff) : new Date())));
}

export async function getLineupCareers(playerIds: string[], matchId: string, cutoff: string | null) {
  if (!playerIds.length) return [];
  recordStatsCache(cutoff ? "lineup.historical" : "lineup.realtime", "readCalls");
  return projectLineupCareers(await getLineupPopulation(matchId, cutoff), playerIds);
}
