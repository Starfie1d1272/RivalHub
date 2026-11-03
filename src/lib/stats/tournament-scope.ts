import "server-only";
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionEntries, matchDemoImports, matchDemoStatProjections, matchMaps, matches, seasons, teams } from "@/db/schema";
import { isCompetitionMatch } from "@/lib/matches/competition-context";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { CURRENT_DAK_SEMANTIC_PROFILE } from "@/lib/demo-integration/semantic-profile";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { resolveGameplayUsersBySteam64InTx } from "@/lib/identity/gameplay-steam";
import { loadEffectiveMatchRosterIdentities, type EffectiveMatchRosterIdentity } from "@/lib/match-rosters/effective";
import { performanceTransportSelection, tournamentTransportSelection } from "./projection-transport";
import { STATISTICS_PROJECTION_VERSION } from "./projection-version";
import type { PlatformStatsScope as StatsEvidenceScope } from "./tournament-query";

const statsMatchFields = {id:matches.id,seasonId:matches.seasonId,stage:matches.stage,round:matches.round,entryAId:matches.entryAId,entryBId:matches.entryBId,majorStageRunId:matches.majorStageRunId,status:matches.status,isForfeit:matches.isForfeit,testConfig:matches.testConfig,format:matches.format,scoreA:matches.scoreA,scoreB:matches.scoreB,completedAt:matches.completedAt};
const statsMapFields = {id:matchMaps.id,matchId:matchMaps.matchId,mapOrder:matchMaps.mapOrder,mapName:matchMaps.mapName,scoreA:matchMaps.scoreA,scoreB:matchMaps.scoreB,completedAt:matchMaps.completedAt};

export async function loadStatsContext(tx: TxDb, scope: StatsEvidenceScope, options: { mapName?: string; teamId?: string; matchIds?: readonly string[]; includeTestMatch?: boolean; effectiveRoster?: readonly EffectiveMatchRosterIdentity[]; skipLabels?: boolean; reuseVetoMatches?: boolean } = {}) {
  const selectedMapRows = options.mapName && options.matchIds?.length !== 0
    ? await tx.select({ match: statsMatchFields, map: statsMapFields }).from(matchMaps).innerJoin(matches, eq(matches.id, matchMaps.matchId)).where(and(
      scope.seasonId ? eq(matches.seasonId, scope.seasonId) : scope.seasonIds ? inArray(matches.seasonId, scope.seasonIds) : undefined,
      eq(matchMaps.mapName, options.mapName),
      options.matchIds ? inArray(matches.id, [...options.matchIds]) : undefined,
      scope.stage ? eq(matches.stage, scope.stage) : undefined,
      scope.format ? eq(matches.format, scope.format) : undefined,
      (options.teamId ?? scope.teamFilter) ? or(eq(matches.entryAId, options.teamId ?? scope.teamFilter!), eq(matches.entryBId, options.teamId ?? scope.teamFilter!)) : undefined,
    ))
    : undefined;
  const matchRows = selectedMapRows
    ? [...new Map(selectedMapRows.map(({ match }) => [match.id, match])).values()]
    : options.matchIds
      ? options.matchIds.length ? await tx.select(statsMatchFields).from(matches).where(and(
        inArray(matches.id, [...options.matchIds]),
        scope.seasonId ? eq(matches.seasonId, scope.seasonId) : scope.seasonIds ? inArray(matches.seasonId, scope.seasonIds) : undefined,
        scope.stage ? eq(matches.stage, scope.stage) : undefined,
        scope.format ? eq(matches.format, scope.format) : undefined,
      )) : []
      : scope.seasonId || scope.seasonIds ? await tx.select(statsMatchFields).from(matches).where(and(
        scope.seasonId ? eq(matches.seasonId, scope.seasonId) : scope.seasonIds ? inArray(matches.seasonId, scope.seasonIds) : undefined,
        scope.stage ? eq(matches.stage, scope.stage) : undefined,
        scope.format ? eq(matches.format, scope.format) : undefined,
      )) : [];
  const vetoMatches = options.reuseVetoMatches && (scope.seasonId || scope.seasonIds) && !options.mapName && !options.matchIds && !options.teamId && !scope.teamFilter
    ? matchRows.filter((match) => match.testConfig === null).map(({ id, status, isForfeit, entryAId, entryBId }) => ({ id, status, isForfeit, entryAId, entryBId }))
    : undefined;
  const selectedTeamId = options.teamId ?? scope.teamFilter;
  const baseMatches = matchRows.filter(isCompetitionMatch).filter(match => options.includeTestMatch || !match.testConfig);
  const scopedMatches = baseMatches.filter((match) => !selectedTeamId || [match.entryAId, match.entryBId].includes(selectedTeamId));
  const matchesById = new Map(scopedMatches.map((match) => [match.id, match]));
  const matchIds = scopedMatches.map((match) => match.id);
  const seasonIds = scope.seasonId ? [scope.seasonId] : [...new Set(scopedMatches.map((match) => match.seasonId))];
  const entryRows = !options.skipLabels && seasonIds.length ? await tx.select({ id: competitionEntries.id, name: competitionEntries.name, teamId: competitionEntries.teamId, teamName: teams.name, teamSlug: teams.slug, eventSlug: seasons.slug, eventName: seasons.name }).from(competitionEntries)
    .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
    .leftJoin(teams, eq(teams.id, competitionEntries.teamId))
    .where(inArray(competitionEntries.competitionId, seasonIds)) : [];
  const entries = entryRows.map((row) => ({ id: row.id, name: row.name }));
  const participantIds = new Set(baseMatches.filter((match) => match.status === "finished").flatMap((match) => [match.entryAId, match.entryBId].filter((id): id is string => Boolean(id))));
  const participantEntries = entries.filter((entry) => participantIds.has(entry.id));
  const maps = selectedMapRows
    ? selectedMapRows.filter(({ match }) => matchesById.has(match.id)).map(({ map }) => map)
    : matchIds.length ? await tx.select(statsMapFields).from(matchMaps).where(inArray(matchMaps.matchId, matchIds)) : [];
  const mapNameFilter = options.mapName ?? scope.mapFilter;
  const scopedMaps = maps.filter((map) => !mapNameFilter || map.mapName === mapNameFilter);
  const matchIdSet = new Set(matchIds);
  const roster = options.effectiveRoster ? options.effectiveRoster.filter(row => matchIdSet.has(row.matchId)) : await loadEffectiveMatchRosterIdentities(tx, matchIds);
  const rosterByMatchId = new Map<string, EffectiveMatchRosterIdentity[]>();
  const rosterByMatchAndUser = new Map<string, Map<string, EffectiveMatchRosterIdentity>>();
  for (const member of roster) {
    const matchRoster = rosterByMatchId.get(member.matchId) ?? [];
    matchRoster.push(member);
    rosterByMatchId.set(member.matchId, matchRoster);
    const membersByUser = rosterByMatchAndUser.get(member.matchId) ?? new Map<string, EffectiveMatchRosterIdentity>();
    if (!membersByUser.has(member.userId)) membersByUser.set(member.userId, member);
    rosterByMatchAndUser.set(member.matchId, membersByUser);
  }

  type ImportMetadata = Pick<typeof matchDemoImports.$inferSelect, "id" | "matchMapId" | "semanticProfile" | "status" | "evidenceRevision" | "createdAt" | "payloadSha256" | "demoSha256" | "analysisVersion">;
  const imports = scopedMaps.length
    ? await tx.selectDistinctOn([matchDemoImports.matchMapId], {
      id: matchDemoImports.id,
      matchMapId: matchDemoImports.matchMapId,
      semanticProfile: matchDemoImports.semanticProfile,
      status: matchDemoImports.status,
      evidenceRevision: matchDemoImports.evidenceRevision,
      payloadSha256: matchDemoImports.payloadSha256,
      demoSha256: matchDemoImports.demoSha256,
      analysisVersion: matchDemoImports.analysisVersion,
      createdAt: matchDemoImports.createdAt,
    }).from(matchDemoImports).where(and(inArray(matchDemoImports.matchMapId, scopedMaps.map((map) => map.id)),
      sql`${matchDemoImports.semanticProfile} COLLATE "C" = ${CURRENT_DAK_SEMANTIC_PROFILE} COLLATE "C"`,
      ne(matchDemoImports.status, "superseded")))
      .orderBy(asc(matchDemoImports.matchMapId), desc(matchDemoImports.createdAt), desc(matchDemoImports.id))
    : [];
  const importsByMapId = new Map<string, ImportMetadata[]>();
  for (const row of imports) {
    const mapImports = importsByMapId.get(row.matchMapId) ?? [];
    mapImports.push(row);
    importsByMapId.set(row.matchMapId, mapImports);
  }

  const currentRefs = scopedMaps.flatMap((map) => {
    const current = selectCurrentDemoImport(importsByMapId.get(map.id) ?? []);
    const match = matchesById.get(map.matchId);
    if (!current || !match || current.status !== "confirmed" || !map.completedAt || map.scoreA === null || map.scoreB === null) return [];
    if (current.evidenceRevision !== buildEvidenceRevisionForTarget({ match, map, roster: rosterByMatchId.get(match.id) ?? [] })) return [];
    return [{ current, match, map }];
  });
  return { entryRows, matches: scopedMatches, matchIds, entries, participantEntries, maps, scopedMaps, roster, rosterByMatchAndUser, currentRefs, vetoMatches };
}

/** Select valid materialized bindings without transferring statistics or Evidence. */
export async function loadCurrentProjectionRefs(tx: TxDb, context: Awaited<ReturnType<typeof loadStatsContext>>, includePerformanceHash = false, includeTournamentHash = false) {
  const ids = context.currentRefs.map(({ current }) => current.id);
  const rows = ids.length ? await tx.select({
    importId: matchDemoStatProjections.importId,
    identityBindings: matchDemoStatProjections.identityBindings,
    ...(includePerformanceHash ? { performanceHash: sql<string>`encode(sha256(convert_to((${performanceTransportSelection})::text, 'UTF8')), 'hex')` } : {}),
    ...(includeTournamentHash ? { tournamentHash: sql<string>`encode(sha256(convert_to((${tournamentTransportSelection})::text, 'UTF8')), 'hex')` } : {}),
    metadataMatches: sql<boolean>`
      ${matchDemoStatProjections.payloadSha256} COLLATE "C" = ${matchDemoImports.payloadSha256} COLLATE "C"
      AND ${matchDemoStatProjections.demoSha256} COLLATE "C" = ${matchDemoImports.demoSha256} COLLATE "C"
      AND ${matchDemoStatProjections.evidenceRevision} COLLATE "C" = ${matchDemoImports.evidenceRevision} COLLATE "C"
      AND ${matchDemoStatProjections.semanticProfile} COLLATE "C" = ${matchDemoImports.semanticProfile} COLLATE "C"
      AND ${matchDemoStatProjections.analysisVersion} COLLATE "C" = ${matchDemoImports.analysisVersion} COLLATE "C"`,
  }).from(matchDemoStatProjections).innerJoin(matchDemoImports, eq(matchDemoImports.id, matchDemoStatProjections.importId)).where(and(
    inArray(matchDemoStatProjections.importId, ids),
    eq(matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION),
  )) : [];
  const projections = new Map(rows.map((row) => [row.importId, row]));
  const resolutions = await resolveGameplayUsersBySteam64InTx(tx, rows.flatMap((row) => row.identityBindings.map((binding) => binding.steam64)));
  return context.currentRefs.flatMap(({ current, match, map }) => {
    const projection = projections.get(current.id);
    if (!projection || !projection.metadataMatches) return [];
    const roster = context.rosterByMatchAndUser.get(match.id);
    // Identity retirement invalidates every dependent map, including other
    // events. Missing/stale projections lower coverage, never trigger raw reads.
    if (projection.identityBindings.length !== 10 || !projection.identityBindings.every((binding) =>
      resolutions.get(binding.steam64)?.userId === binding.userId
      && roster?.get(binding.userId)?.entryId === binding.entryId
    )) return [];
    return [{ current, match, map, projection }];
  });
}
