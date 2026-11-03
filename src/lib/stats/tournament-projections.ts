import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matchDemoStatProjections, steamProfiles, users } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getPerformanceText, putPerformanceText, getTournamentText, putTournamentText } from "./performance-text-cache";
import { decodePerformanceTransport, performanceTransportSelection, decodeTournamentTransport, tournamentTransportSelection, ProjectionTransportIntegrityError } from "./projection-transport";
import { STATISTICS_PROJECTION_VERSION } from "./projection-version";
import { loadStatsContext, loadCurrentProjectionRefs } from "./tournament-scope";
import type { PlatformStatsScope as StatsEvidenceScope, StatsLabels } from "./tournament-query";

export async function loadStatsEvidence(tx: TxDb, scope: StatsEvidenceScope, options: { mapName?: string; teamId?: string; matchIds?: readonly string[]; includeTestMatch?: boolean; reuseVetoMatches?: boolean } = {}) {
  if (!scope.view) return loadStatsEvidenceSelection(tx, scope, options,
    sql<typeof matchDemoStatProjections.$inferSelect.facts>`jsonb_build_object(
      'records', (${matchDemoStatProjections.facts}->'records') - 'events')`, true, true);
  const needsTournament = ["overview", "teams", "maps"].includes(scope.view);
  const needsPerformance = scope.view !== "records" && (scope.view !== "maps" || scope.mapDetail);
  // DAK owns its opaque performance accumulator. Select it verbatim whenever
  // consumed; never reconstruct or trim inside its private `data` field.
  const tournament = needsTournament ? sql`'{}'::jsonb` : sql`jsonb_build_object('tournament', jsonb_build_object(
    'mapKey', ${matchDemoStatProjections.facts}->'tournament'->'mapKey',
    'matchKey', ${matchDemoStatProjections.facts}->'tournament'->'matchKey',
    'mapName', ${matchDemoStatProjections.facts}->'tournament'->'mapName'))`;
  const performance = needsPerformance ? sql`'{}'::jsonb` : sql`jsonb_build_object('performance', jsonb_build_object(
    'mapKey', ${matchDemoStatProjections.facts}->'performance'->'mapKey',
    'matchKey', ${matchDemoStatProjections.facts}->'performance'->'matchKey'))`;
  return loadStatsEvidenceSelection(tx, scope, options, sql<typeof matchDemoStatProjections.$inferSelect.facts>`jsonb_build_object(
    'records', ${scope.view === "records" ? sql`(${matchDemoStatProjections.facts}->'records') - 'events'` : sql`NULL`}) || ${tournament} || ${performance}`, needsPerformance, needsTournament);
}

/** Team/map details consume both analytics owners, but never record candidates. */
export async function loadStatsDetailEvidence(tx: TxDb, scope: StatsEvidenceScope, options: Parameters<typeof loadStatsContext>[2] = {}) {
  return loadStatsEvidenceSelection(tx, scope, options, sql<Pick<typeof matchDemoStatProjections.$inferSelect.facts, "tournament" | "performance">>`'{}'::jsonb`, true, true);
}

export type PlayerDetailFacts = {
  tournament: Pick<typeof matchDemoStatProjections.$inferSelect.facts.tournament, "mapKey" | "matchKey" | "mapName">;
  performance: typeof matchDemoStatProjections.$inferSelect.facts.performance;
};

export type ProjectionTargets = {
  tournament: { mapKey: string; matchKey: string };
  performance: { mapKey: string; matchKey: string };
};

export async function loadStatsEvidenceSelection<T extends ProjectionTargets>(
  tx: TxDb,
  scope: StatsEvidenceScope,
  options: Parameters<typeof loadStatsContext>[2],
  factsSelection: SQL<T>,
  includePerformance = false,
  includeTournament = false,
) {
  const context = await loadStatsContext(tx, scope, options);
  const refs = await loadCurrentProjectionRefs(tx, context, includePerformance, includeTournament);
  const importIds = refs.map(({ current }) => current.id);
  const rows = importIds.length ? await tx.select({ importId: matchDemoStatProjections.importId, facts: factsSelection })
    .from(matchDemoStatProjections).where(and(inArray(matchDemoStatProjections.importId, importIds), eq(matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION))) : [];
  const factsByImport = new Map(rows.map((row) => [row.importId, row.facts]));
  const tournamentTexts = new Map<string, { text: string; key: string; cached: boolean }>();
  if (includeTournament) {
    const missing: string[] = [];
    for (const { current, projection } of refs) {
      const key = `tournament-text-v1:${STATISTICS_PROJECTION_VERSION}:${current.id}:${projection.tournamentHash}`;
      const text = getTournamentText(key);
      if (text === undefined) missing.push(current.id);
      else tournamentTexts.set(current.id, { text, key, cached: true });
    }
    const texts = missing.length ? await tx.select({ importId: matchDemoStatProjections.importId,
      text: sql<string>`(${tournamentTransportSelection})::text`,
    }).from(matchDemoStatProjections).where(and(inArray(matchDemoStatProjections.importId, missing),
      eq(matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION))) : [];
    const refsById = new Map(refs.map((ref) => [ref.current.id, ref]));
    for (const { importId, text } of texts) {
      const ref = refsById.get(importId)!;
      const key = `tournament-text-v1:${STATISTICS_PROJECTION_VERSION}:${importId}:${ref.projection.tournamentHash}`;
      tournamentTexts.set(importId, { text, key, cached: false });
    }
  }
  const performanceTexts = new Map<string, { text: string; key: string; cached: boolean }>();
  if (includePerformance) {
    const missing: string[] = [];
    for (const { current, projection } of refs) {
      const key = `performance-text-v1:${STATISTICS_PROJECTION_VERSION}:${current.id}:${projection.performanceHash}`;
      const text = getPerformanceText(key);
      if (text === undefined) missing.push(current.id);
      else performanceTexts.set(current.id, { text, key, cached: true });
    }
    const texts = missing.length ? await tx.select({ importId: matchDemoStatProjections.importId,
      text: sql<string>`(${performanceTransportSelection})::text`,
    }).from(matchDemoStatProjections).where(and(inArray(matchDemoStatProjections.importId, missing),
      eq(matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION))) : [];
    const refsById = new Map(refs.map((ref) => [ref.current.id, ref]));
    for (const { importId, text } of texts) {
      const ref = refsById.get(importId)!;
      const key = `performance-text-v1:${STATISTICS_PROJECTION_VERSION}:${importId}:${ref.projection.performanceHash}`;
      performanceTexts.set(importId, { text, key, cached: false });
    }
  }
  const selected: Array<{ importId: string; facts: T }> = [];
  const verifiedTexts: Array<{ key: string; text: string }> = [];
  const verifiedTournamentTexts: Array<{ key: string; text: string }> = [];
  for (const { current, map, match, projection } of refs) {
    let facts = factsByImport.get(current.id);
    const tournamentText = includeTournament ? tournamentTexts.get(current.id) : undefined;
    if (includeTournament && facts) {
      if (!tournamentText || (!tournamentText.cached && createHash("sha256").update(tournamentText.text, "utf8").digest("hex") !== projection.tournamentHash)) {
        throw new ProjectionTransportIntegrityError();
      }
      facts = { ...facts, ...JSON.parse(tournamentText.text) };
    }
    if (facts && Object.hasOwn(facts, "tournamentTransport")) {
      if (facts.tournament.mapKey !== map.id || facts.tournament.matchKey !== match.id) {
        throw new Error("Statistics projection target mismatch");
      }
      const tournament = await decodeTournamentTransport((facts as T & { tournamentTransport: unknown }).tournamentTransport);
      if (tournament.mapKey !== map.id || tournament.matchKey !== match.id || tournament.mapName !== map.mapName ||
        tournament.semanticProfile !== current.semanticProfile || tournament.analysisVersion !== current.analysisVersion) throw new ProjectionTransportIntegrityError();
      facts = { ...facts, tournament };
    }
    const performanceText = includePerformance ? performanceTexts.get(current.id) : undefined;
    if (includePerformance && facts) {
      if (!performanceText || (!performanceText.cached && createHash("sha256").update(performanceText.text, "utf8").digest("hex") !== projection.performanceHash)) {
        throw new ProjectionTransportIntegrityError();
      }
      facts = { ...facts, ...JSON.parse(performanceText.text) };
    }
    if (facts && Object.hasOwn(facts, "performanceTransport")) {
      const performance = await decodePerformanceTransport((facts as T & { performanceTransport: unknown }).performanceTransport);
      if (performance.mapKey !== map.id || performance.matchKey !== match.id || performance.mapName !== map.mapName ||
        performance.semanticProfile !== current.semanticProfile || performance.analysisVersion !== current.analysisVersion) throw new ProjectionTransportIntegrityError();
      facts = { ...facts, performance };
    }
    if (!facts || facts.tournament.mapKey !== map.id || facts.performance.mapKey !== map.id
      || facts.tournament.matchKey !== match.id || facts.performance.matchKey !== match.id) {
      throw new Error("Statistics projection target mismatch");
    }
    if (performanceText && !performanceText.cached) verifiedTexts.push(performanceText);
    if (tournamentText && !tournamentText.cached) verifiedTournamentTexts.push(tournamentText);
    selected.push({ importId: current.id, facts });
  }
  const userIds = [...new Set(refs.flatMap(({ projection }) => projection.identityBindings.map((binding) => binding.userId)))];
  const identities = userIds.length ? await tx.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName })
    .from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(inArray(users.id, userIds)) : [];
  const labels: StatsLabels = {
    teams: Object.fromEntries(context.entries.map((entry) => [entry.id, entry.name])),
    players: Object.fromEntries(identities.map((user) => [user.id, getPublicDisplayName(user)])),
  };
  for (const { key, text } of verifiedTexts) putPerformanceText(key, text);
  for (const { key, text } of verifiedTournamentTexts) putTournamentText(key, text);
  return { ...context, selected, labels };
}
