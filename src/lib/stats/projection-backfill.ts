import "server-only";

import { and, asc, desc, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { matchDemoImports, matchDemoStatProjections, matchMaps, matches } from "@/db/schema";
import { demoImportMetadataSelection } from "@/lib/demo-integration/metadata";
import { lockDemoImportLineageInTx } from "@/lib/demo-integration/promotion";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { parseStoredEvidence, writeRecheckIssue } from "@/lib/demo-integration/revalidation";
import { CURRENT_DAK_SEMANTIC_PROFILE } from "@/lib/demo-integration/semantic-profile";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { loadCanonicalTarget, validateCanonicalTarget } from "@/lib/demo-integration/validation";
import { resolveGameplayUsersBySteam64InTx } from "@/lib/identity/gameplay-steam";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { materializeStatisticsProjectionInTx, STATISTICS_PROJECTION_VERSION } from "./projection";

/** Read only metadata, even when a map has many historical artifacts. */
async function currentProjectionCandidate(tx: TxDb, matchMapId: string) {
  const rows = await tx.select(demoImportMetadataSelection).from(matchDemoImports)
    .where(eq(matchDemoImports.matchMapId, matchMapId))
    .orderBy(desc(matchDemoImports.createdAt), desc(matchDemoImports.id));
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

/** One consistent, read-only snapshot; missing current projections block release routing. */
export async function inspectStatisticsProjectionCoverage(tx: TxDb) {
  const maps = await tx.selectDistinct({ matchMapId: matchDemoImports.matchMapId }).from(matchDemoImports);
  let eligibleMaps = 0;
  let missing = 0;
  for (const { matchMapId } of maps) {
    const candidate = await currentProjectionCandidate(tx, matchMapId);
    if (!candidate) continue;
    eligibleMaps++;
    if (!await hasCurrentProjection(tx, candidate)) missing++;
  }
  return { projectionVersion: STATISTICS_PROJECTION_VERSION, eligibleMaps, missing, ready: missing === 0 };
}


/** Only the scheduler/release path may repair old-writer gaps; page reads never do. */
export async function reconcileMissingStatisticsProjections(database: DB, options: { limit?: number } = {}) {
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Projection rebuild limit must be a positive integer");
  // Select the current lineage BEFORE testing confirmed, so a newer rejected or
  // pending import cannot resurrect an older confirmed artifact. Only IDs cross
  // the wire; stale revisions are cheaply skipped before any raw payload read.
  const latest = database.selectDistinctOn([matchDemoImports.matchMapId], {
    importId: matchDemoImports.id, matchMapId: matchDemoImports.matchMapId, status: matchDemoImports.status,
  }).from(matchDemoImports).where(and(
    eq(matchDemoImports.semanticProfile, CURRENT_DAK_SEMANTIC_PROFILE), ne(matchDemoImports.status, "superseded"),
  )).orderBy(asc(matchDemoImports.matchMapId), desc(matchDemoImports.createdAt), desc(matchDemoImports.id)).as("current_demo_import");
  const candidates = await database.select({ matchMapId: latest.matchMapId }).from(latest)
    .innerJoin(matchMaps, eq(matchMaps.id, latest.matchMapId))
    .leftJoin(matchDemoStatProjections, and(
      eq(matchDemoStatProjections.importId, latest.importId), eq(matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION),
    )).where(and(
      eq(latest.status, "confirmed"), isNotNull(matchMaps.completedAt), isNotNull(matchMaps.scoreA), isNotNull(matchMaps.scoreB),
      isNull(matchDemoStatProjections.importId),
    )).orderBy(asc(latest.matchMapId));
  const report = { candidates: candidates.length, scanned: 0, rebuilt: 0, skipped: 0, invalid: 0, failed: 0 };
  for (const { matchMapId } of candidates) {
    // The bound applies to actual rebuild attempts. Metadata-only stale maps
    // never consume it and therefore cannot starve a valid later map forever.
    if (report.rebuilt + report.invalid + report.failed >= limit) break;
    report.scanned++;
    try {
      const outcome = await database.transaction((tx) => backfillStatisticsProjectionForMapInTx(tx, matchMapId, true, { quarantineInvalid: true }));
      if (outcome === "rebuilt") report.rebuilt++;
      else if (outcome === "invalid") report.invalid++;
      else report.skipped++;
    } catch {
      report.failed++;
    }
  }
  return report;
}
