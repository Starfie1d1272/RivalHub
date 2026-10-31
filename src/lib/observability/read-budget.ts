import "server-only";

const FAMILIES = ["match", "schedule"] as const;
type Family = typeof FAMILIES[number];
type ReadCounter = { requests: number; status200: number; status304: number; failures: number; other: number;
  fullBuilds: number; encodedResponses: number; encodedBodyBytes: number };
const SLOT = Symbol.for("rivalhub.read-budget.v1");
function owner() {
  const host = process as unknown as Record<symbol, { mizar: Record<Family, ReadCounter>; betFallbacks: number }>;
  return host[SLOT] ??= { mizar: Object.fromEntries(FAMILIES.map(name => [name, {
    requests: 0, status200: 0, status304: 0, failures: 0, other: 0,
    fullBuilds: 0, encodedResponses: 0, encodedBodyBytes: 0,
  }])) as Record<Family, ReadCounter>, betFallbacks: 0 };
}

export function recordMizarHttpResult(family: Family, status: number | undefined): void {
  if (!FAMILIES.includes(family)) return;
  const value = owner().mizar[family];
  value.requests++;
  if (status === 200) value.status200++;
  else if (status === 304) value.status304++;
  else if (status === undefined || status >= 400) value.failures++;
  else value.other++;
}

/** Attempted provider builds, including non-GET claim/reliable consumers and failures. */
export function recordMizarFullBuild(family: Family): void {
  if (FAMILIES.includes(family)) owner().mizar[family].fullBuilds++;
}

/** Already encoded context body only; excludes errors, HTTP framing and compression. */
export function recordMizarEncodedBody(family: Family, bytes: number): void {
  if (!FAMILIES.includes(family) || !Number.isSafeInteger(bytes) || bytes < 0) return;
  const value = owner().mizar[family];
  value.encodedResponses++;
  value.encodedBodyBytes += bytes;
}

export function recordBetAggregateFallback(): void { owner().betFallbacks++; }

export const STATS_CACHE_FAMILIES = ["lineup.historical", "lineup.realtime", "lineup.style", "platform", "benchmark"] as const;
export type StatsCacheFamily = typeof STATS_CACHE_FAMILIES[number];
export const STATS_INVALIDATION_REASONS = ["mizar.canonicalized_new", "mizar.canonicalized_duplicate", "dak.evidence", "stats.projection_rebuild", "scoreboard", "identity", "veto", "season_or_other"] as const;
export type StatsInvalidationReason = typeof STATS_INVALIDATION_REASONS[number];
type StatsCacheMetric = "readCalls" | "fillStarted" | "fillSucceeded" | "fillFailed";
type StatsInvalidationMetric = "attempted" | "completed" | "failed";
const STATS_SLOT = Symbol.for("rivalhub.stats-read-budget.v1");
function statsOwner() {
  const host = process as unknown as Record<symbol, Record<string, number> | undefined>;
  return host[STATS_SLOT] ??= Object.create(null) as Record<string, number>;
}
function increment(operation: string): void {
  try { const counters = statsOwner(); counters[operation] = (counters[operation] ?? 0) + 1; } catch { /* Diagnostics must never affect reads or invalidation. */ }
}
export function recordStatsCache(family: StatsCacheFamily, metric: StatsCacheMetric): void {
  if (STATS_CACHE_FAMILIES.includes(family) && ["readCalls", "fillStarted", "fillSucceeded", "fillFailed"].includes(metric)) increment(`stats.cache.${family}.${metric}`);
}
export function recordStatsInvalidation(reason: StatsInvalidationReason, metric: StatsInvalidationMetric): void {
  if (STATS_INVALIDATION_REASONS.includes(reason) && ["attempted", "completed", "failed"].includes(metric)) increment(`stats.invalidation.${reason}.${metric}`);
}
export async function observeStatsCacheFill<T>(family: StatsCacheFamily, read: () => Promise<T>): Promise<T> {
  recordStatsCache(family, "fillStarted");
  try { const value = await read(); recordStatsCache(family, "fillSucceeded"); return value; }
  catch (error) { recordStatsCache(family, "fillFailed"); throw error; }
}
/** Fixed operation names and cumulative counts, with no request data. */
export function getStatsReadCounters(): ReadonlyArray<{ operation: string; count: number }> {
  const counters = statsOwner();
  return Object.entries(counters).map(([operation, count]) => ({ operation, count }));
}

/** Cumulative process counters; restart resets them. No request identifiers or samples. */
export function getReadBudgetSnapshot() {
  return { mizar: FAMILIES.map(family => ({ family, ...owner().mizar[family] })), betFallbacks: owner().betFallbacks };
}
