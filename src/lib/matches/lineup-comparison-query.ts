import { observePublicStatsFill } from "@/lib/stats/public-fill";
import { observeStatsCacheFill, recordStatsCache } from "@/lib/observability/read-budget";
import "server-only";

import { db, type DB } from "@/db/client";
import { getCurrentStatsSelectionInTx } from "@/lib/stats/tournament-query";
import { getLineupStatsFingerprint, getLineupStatsPopulation } from "@/lib/stats/leaderboard-query";
import { partitionRankingPopulation } from "@/lib/stats/ranking";
import type { LineupCareer } from "./lineup-comparison";

/** One metadata selection and one aggregate for both lineups and the historical baseline.
 * No raw Evidence or per-player career/detail queries are read.
 */
// Process-local and bounded: never share results across database instances or deployments.
// No promises are retained, so a failed fill cannot poison or lock later reads.
const populationCache = new Map<string, { value: LineupCareer[]; bytes: number }>();
const MAX_POPULATION_ENTRIES = 32;
const MAX_POPULATION_BYTES = 4 * 1024 * 1024;
let populationBytes = 0;
class FingerprintUnavailable extends Error {}

async function readLineupPopulation(matchId: string, before: Date, database: DB, useCache: boolean, family: "lineup.historical" | "lineup.realtime"): Promise<LineupCareer[]> {
  return database.transaction(async (tx) => {
    const selection = await getCurrentStatsSelectionInTx(tx, { before, excludeMatchId: matchId });
    // The fingerprint and the aggregate read the exact same repeatable-read snapshot.
    // If hashing is unavailable, bypass caching rather than use a weaker key.
    let key: string | undefined;
    if (useCache) {
      try { key = await getLineupStatsFingerprint(selection.currentImportIds, selection.roster, tx); }
      catch { throw new FingerprintUnavailable(); }
    }
    if (key) {
      const hit = populationCache.get(key);
      if (hit) {
        populationCache.delete(key);
        populationCache.set(key, hit);
        return hit.value;
      }
    }
    const population = await observeStatsCacheFill(family, () => observePublicStatsFill("stats.lineup", () => getLineupStatsPopulation(selection.currentImportIds, selection.roster, tx)));
    const { ranked } = partitionRankingPopulation(population, (row) => row.avgRating, (row) => row.rounds);
    const qualified = new Set(ranked.map((row) => row.userId));
    const result = population.filter((row) => row.userId).map((row) => ({
      userId: row.userId!, maps: row.maps, rounds: row.rounds, qualified: qualified.has(row.userId),
      rating: row.avgRating, adr: row.avgAdr, kpr: row.kpr, kast: row.kast, firstKill: row.fkpr, trade: row.tradeKpr,
    }));
    if (key) {
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes <= MAX_POPULATION_BYTES) {
        const previous = populationCache.get(key);
        if (previous) populationBytes -= previous.bytes;
        populationCache.delete(key);
        populationCache.set(key, { value: result, bytes });
        populationBytes += bytes;
        while (populationCache.size > MAX_POPULATION_ENTRIES || populationBytes > MAX_POPULATION_BYTES) {
          const oldest = populationCache.keys().next().value!;
          populationBytes -= populationCache.get(oldest)!.bytes;
          populationCache.delete(oldest);
        }
      }
    }
    return result;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function loadLineupPopulation(matchId: string, before: Date, database: DB = db): Promise<LineupCareer[]> {
  return readLineupPopulation(matchId, before, database, false, "lineup.historical");
}

function projectLineupCareers(population: LineupCareer[], playerIds: readonly string[]) {
  const requested = new Set(playerIds);
  return population.filter(row => requested.has(row.userId));
}

export async function loadLineupCareers(playerIds: readonly string[], matchId: string, before: Date, database: DB = db): Promise<LineupCareer[]> {
  if (!playerIds.length) return [];
  return projectLineupCareers(await loadLineupPopulation(matchId, before, database), playerIds);
}

export async function getLineupCareers(playerIds: string[], matchId: string, cutoff: string | null) {
  if (!playerIds.length) return [];
  recordStatsCache(cutoff ? "lineup.historical" : "lineup.realtime", "readCalls");
  const before = cutoff ? new Date(cutoff) : new Date();
  const family = cutoff ? "lineup.historical" : "lineup.realtime";
  let population: LineupCareer[];
  try { population = await readLineupPopulation(matchId, before, db, true, family); }
  catch (error) {
    if (!(error instanceof FingerprintUnavailable)) throw error;
    // A failed SQL statement aborts its transaction. Retry uncached in a fresh snapshot.
    population = await readLineupPopulation(matchId, before, db, false, family);
  }
  return projectLineupCareers(population, playerIds);
}
