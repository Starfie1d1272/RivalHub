import "server-only";

import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { matchDemoImports, matchDemoStatProjections, matchMaps, matches, seasons, statisticsProjectionRepairCursors } from "@/db/schema";
import { demoImportMetadataSelection } from "@/lib/demo-integration/metadata";
import { lockDemoImportLineageInTx } from "@/lib/demo-integration/promotion";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { parseStoredEvidence, writeRecheckIssue } from "@/lib/demo-integration/revalidation";
import { CURRENT_DAK_SEMANTIC_PROFILE } from "@/lib/demo-integration/semantic-profile";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { loadCanonicalTarget, validateCanonicalTarget } from "@/lib/demo-integration/validation";
import { resolveGameplayUsersBySteam64InTx } from "@/lib/identity/gameplay-steam";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { PLATFORM_ROUTE_SEGMENTS } from "@/lib/seasons/slug";
import { materializeStatisticsProjectionInTx, STATISTICS_PROJECTION_VERSION } from "./projection";

/** Read only the latest eligible lineage metadata, bounded even with many historical artifacts. */
async function currentProjectionCandidate(tx: TxDb, matchMapId: string) {
  const rows = await tx.select(demoImportMetadataSelection).from(matchDemoImports)
    .where(and(eq(matchDemoImports.matchMapId, matchMapId),
      eq(matchDemoImports.semanticProfile, CURRENT_DAK_SEMANTIC_PROFILE), ne(matchDemoImports.status, "superseded")))
    .orderBy(desc(matchDemoImports.createdAt), desc(matchDemoImports.id)).limit(1);
  const current = selectCurrentDemoImport(rows);
  if (!current || current.status !== "confirmed") return null;
  const [mapMatch] = await tx.select({ map: matchMaps, match: matches }).from(matchMaps)
    .innerJoin(matches, eq(matches.id, matchMaps.matchId)).where(eq(matchMaps.id, matchMapId));
  if (!mapMatch || !mapMatch.map.completedAt || mapMatch.map.scoreA === null || mapMatch.map.scoreB === null) return null;
  const roster = await loadEffectiveMatchRoster(tx, [mapMatch.match.id]);
  const target = { ...mapMatch, roster };
  if (buildEvidenceRevisionForTarget(target) !== current.evidenceRevision) return null;
  return { current, target };
}

async function hasCurrentProjection(tx: TxDb, candidate: NonNullable<Awaited<ReturnType<typeof currentProjectionCandidate>>>) {
  const { current, target } = candidate;
  const [projection] = await tx.select({
    payloadSha256: matchDemoStatProjections.payloadSha256,
    demoSha256: matchDemoStatProjections.demoSha256,
    evidenceRevision: matchDemoStatProjections.evidenceRevision,
    semanticProfile: matchDemoStatProjections.semanticProfile,
    analysisVersion: matchDemoStatProjections.analysisVersion,
    identityBindings: matchDemoStatProjections.identityBindings,
  }).from(matchDemoStatProjections).where(and(
    eq(matchDemoStatProjections.importId, current.id),
    eq(matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION),
  ));
  if (!projection || projection.payloadSha256 !== current.payloadSha256 || projection.demoSha256 !== current.demoSha256 ||
    projection.evidenceRevision !== current.evidenceRevision || projection.semanticProfile !== current.semanticProfile ||
    projection.analysisVersion !== current.analysisVersion) return false;
  const resolutions = await resolveGameplayUsersBySteam64InTx(tx, projection.identityBindings.map((binding) => binding.steam64));
  return projection.identityBindings.length === target.roster.length && projection.identityBindings.every((binding) =>
    resolutions.get(binding.steam64)?.userId === binding.userId &&
    target.roster.some((member) => member.userId === binding.userId && member.entryId === binding.entryId));
}

export type ProjectionBackfillOutcome = "not_current" | "unchanged" | "missing" | "rebuilt" | "invalid";

/** The only raw read is a single current map needing a rebuild, under its lineage lock. */
export async function backfillStatisticsProjectionForMapInTx(
  tx: TxDb,
  matchMapId: string,
  apply: boolean,
  options: { quarantineInvalid?: boolean } = {},
): Promise<ProjectionBackfillOutcome> {
  if (apply) await lockDemoImportLineageInTx(tx, matchMapId);
  const candidate = await currentProjectionCandidate(tx, matchMapId);
  if (!candidate) return "not_current";
  if (await hasCurrentProjection(tx, candidate)) return "unchanged";
  if (!apply) return "missing";
  const { current } = candidate;
  // Match lock shares the normal confirmation boundary; recheck revision after
  // taking it in case a score/roster correction committed while we waited.
  const target = await loadCanonicalTarget(tx, { seasonId: current.seasonId, matchId: current.matchId, matchMapId });
  if (buildEvidenceRevisionForTarget(target) !== current.evidenceRevision) return "not_current";
  const [row] = await tx.select().from(matchDemoImports).where(eq(matchDemoImports.id, current.id)).for("update");
  if (!row || row.status !== "confirmed") return "not_current";
  const stored = parseStoredEvidence(row);
  if (!stored.evidence || stored.issues.length) {
    if (!options.quarantineInvalid) throw new Error(`Statistics projection source integrity failed: ${current.id}`);
    await writeRecheckIssue(tx, row, stored.issues, target, "system:statistics-projection");
    return "invalid";
  }
  const validation = await validateCanonicalTarget(tx, stored.evidence, target);
  if (validation.issues.length) {
    if (!options.quarantineInvalid) throw new Error(`Statistics projection canonical validation failed: ${current.id}`);
    await writeRecheckIssue(tx, row, validation.issues, target, "system:statistics-projection");
    return "invalid";
  }
  await materializeStatisticsProjectionInTx({ tx, row, evidence: stored.evidence, target, resolutions: validation.resolutions });
  return "rebuilt";
}

export interface StatisticsProjectionBackfillReport {
  projectionVersion: string;
  scannedMaps: number;
  eligibleMaps: number;
  unchanged: number;
  rebuilt: number;
  missing: number;
  invalid: number;
  complete: boolean;
}

/** Keyset batches bound memory; each map commits independently and retries are idempotent. */
export async function backfillStatisticsProjections(
  database: DB,
  options: { apply: boolean; limit?: number; batchSize?: number },
): Promise<StatisticsProjectionBackfillReport> {
  const report: StatisticsProjectionBackfillReport = {
    projectionVersion: STATISTICS_PROJECTION_VERSION, scannedMaps: 0, eligibleMaps: 0,
    unchanged: 0, rebuilt: 0, missing: 0, invalid: 0, complete: true,
  };
  const batchSize = options.batchSize ?? 50;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("Projection batch size must be a positive integer");
  let after: string | undefined;
  while (true) {
    const batch = await database.selectDistinct({ matchMapId: matchDemoImports.matchMapId }).from(matchDemoImports)
      .where(after ? gt(matchDemoImports.matchMapId, after) : undefined)
      .orderBy(asc(matchDemoImports.matchMapId)).limit(batchSize);
    if (!batch.length) break;
    for (const { matchMapId } of batch) {
      if (options.limit !== undefined && report.rebuilt + report.missing >= options.limit) {
        report.complete = false;
        return report;
      }
      const outcome = await database.transaction((tx) => backfillStatisticsProjectionForMapInTx(tx, matchMapId, options.apply),
        options.apply ? undefined : { isolationLevel: "repeatable read", accessMode: "read only" });
      report.scannedMaps++;
      if (outcome !== "not_current") {
        report.eligibleMaps++;
        report[outcome]++;
      }
      after = matchMapId;
    }
  }
  return report;
}

/** One consistent, read-only snapshot; an exhausted budget can never pass the release gate. */
export async function inspectStatisticsProjectionCoverage(
  tx: TxDb,
  options: { batchSize?: number; scanLimit?: number; maxDurationMs?: number } = {},
) {
  const batchSize = positiveInteger(options.batchSize ?? 50, "Coverage batch size");
  const scanLimit = positiveInteger(options.scanLimit ?? 10_000, "Coverage scan limit");
  const maxDurationMs = positiveInteger(options.maxDurationMs ?? 60_000, "Coverage duration");
  const startedAt = Date.now();
  const deadline = startedAt + maxDurationMs;
  const routeConflicts = await tx.select({ id: seasons.id, slug: seasons.slug }).from(seasons).where(inArray(seasons.slug, [...PLATFORM_ROUTE_SEGMENTS]));
  let after: string | undefined;
  let scanned = 0;
  let eligibleMaps = 0;
  let missing = 0;
  let complete = false;
  while (Date.now() < deadline) {
    await tx.execute(sql`SELECT set_config('statement_timeout', ${String(Math.max(1, deadline - Date.now()))}, true)`);
    // One extra ID distinguishes a complete scan from an exactly exhausted budget.
    const maps = await tx.selectDistinct({ matchMapId: matchDemoImports.matchMapId }).from(matchDemoImports)
      .where(after ? gt(matchDemoImports.matchMapId, after) : undefined)
      .orderBy(asc(matchDemoImports.matchMapId)).limit(Math.min(batchSize, scanLimit - scanned + 1));
    if (!maps.length) { complete = true; break; }
    for (const { matchMapId } of maps) {
      if (scanned >= scanLimit || Date.now() >= deadline) {
        return { projectionVersion: STATISTICS_PROJECTION_VERSION, scanned, eligibleMaps, missing, complete: false, ready: false, durationMs: Date.now() - startedAt };
      }
      const candidate = await currentProjectionCandidate(tx, matchMapId);
      scanned++;
      after = matchMapId;
      if (!candidate) continue;
      eligibleMaps++;
      if (!await hasCurrentProjection(tx, candidate)) missing++;
    }
  }
  return { projectionVersion: STATISTICS_PROJECTION_VERSION, scanned, eligibleMaps, missing, complete, ready: complete && missing === 0 && routeConflicts.length === 0, routeConflicts, durationMs: Date.now() - startedAt };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

/** Only the scheduler/release path may repair old-writer gaps; page reads never do. */
export async function reconcileMissingStatisticsProjections(database: DB, options: { limit?: number; scanLimit?: number; maxDurationMs?: number } = {}) {
  const limit = positiveInteger(options.limit ?? 10, "Projection rebuild limit");
  const scanLimit = positiveInteger(options.scanLimit ?? 50, "Projection scan limit");
  const startedAt = Date.now();
  const deadline = startedAt + positiveInteger(options.maxDurationMs ?? 20_000, "Projection repair duration");
  const report = { candidates: 0, scanned: 0, rebuilt: 0, skipped: 0, invalid: 0, failed: 0,
    afterMapId: null as string | null, wrapped: false, budgetExhausted: false };
  while (report.scanned < scanLimit) {
    if (report.rebuilt + report.invalid + report.failed >= limit || Date.now() >= deadline) {
      report.budgetExhausted = true;
      break;
    }
    // Claim one map at a time: advancing past an unprocessed batch suffix can
    // starve it forever when the same early maps repeatedly exhaust the budget.
    let matchMapId: string | null;
    try {
      matchMapId = await claimNextProjectionRepairMap(database);
    } catch {
      // Preserve prior committed transitions so the scheduler invalidates them
      // before reporting a later candidate-selection dependency failure.
      report.failed++;
      break;
    }
    report.afterMapId = matchMapId;
    if (!matchMapId) { report.wrapped = true; break; }
    report.candidates++;
    report.scanned++;
    try {
      const outcome = await database.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('statement_timeout', ${String(Math.max(1, Math.min(5000, deadline - Date.now())))}, true)`);
        return backfillStatisticsProjectionForMapInTx(tx, matchMapId, true, { quarantineInvalid: true });
      });
      if (outcome === "rebuilt") report.rebuilt++;
      else if (outcome === "invalid") report.invalid++;
      else report.skipped++;
    } catch {
      report.failed++;
    }
  }
  return { ...report, budgetExhausted: report.budgetExhausted || report.scanned === scanLimit, durationMs: Date.now() - startedAt };
}

/** Claims commit before identity locks; a lost claim is revisited on wrap. */
async function claimNextProjectionRepairMap(database: DB): Promise<string | null> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    await tx.insert(statisticsProjectionRepairCursors).values({ projectionVersion: STATISTICS_PROJECTION_VERSION }).onConflictDoNothing();
    const [cursor] = await tx.select().from(statisticsProjectionRepairCursors)
      .where(eq(statisticsProjectionRepairCursors.projectionVersion, STATISTICS_PROJECTION_VERSION)).for("update");
    // Select the current lineage BEFORE testing confirmed, so a newer rejected or
    // pending import cannot resurrect an older confirmed artifact. Only IDs cross
    // the wire; stale revisions are cheaply skipped before any raw payload read.
    const latest = tx.selectDistinctOn([matchDemoImports.matchMapId], {
      importId: matchDemoImports.id, matchMapId: matchDemoImports.matchMapId, status: matchDemoImports.status,
    }).from(matchDemoImports).where(and(
      eq(matchDemoImports.semanticProfile, CURRENT_DAK_SEMANTIC_PROFILE), ne(matchDemoImports.status, "superseded"),
      cursor!.afterMapId ? gt(matchDemoImports.matchMapId, cursor!.afterMapId) : undefined,
    )).orderBy(asc(matchDemoImports.matchMapId), desc(matchDemoImports.createdAt), desc(matchDemoImports.id)).as("current_demo_import");
    const candidates = await tx.select({ matchMapId: latest.matchMapId }).from(latest)
      .innerJoin(matchMaps, eq(matchMaps.id, latest.matchMapId))
      .leftJoin(matchDemoStatProjections, and(
        eq(matchDemoStatProjections.importId, latest.importId), eq(matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION),
      )).where(and(
        eq(latest.status, "confirmed"), isNotNull(matchMaps.completedAt), isNotNull(matchMaps.scoreA), isNotNull(matchMaps.scoreB),
        isNull(matchDemoStatProjections.importId),
      )).orderBy(asc(latest.matchMapId)).limit(1);
    const afterMapId = candidates.at(-1)?.matchMapId ?? null;
    await tx.update(statisticsProjectionRepairCursors).set({ afterMapId, updatedAt: new Date() })
      .where(eq(statisticsProjectionRepairCursors.projectionVersion, STATISTICS_PROJECTION_VERSION));
    return afterMapId;
  });
}
