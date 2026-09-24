import "server-only";

import { and, count, desc, eq, inArray, ne, or } from "drizzle-orm";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { db, type DB, type TxDb } from "@/db/client";
import { competitionEntries, eventRosterMembers, matchDemoImports, matchMaps, matchRosterPlayers, matchRosters, matches, matchVetoSteps, seasons, steamProfiles, users } from "@/db/schema";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { resolveGameplayUsersBySteam64 } from "@/lib/identity/gameplay-steam";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { loadEffectiveMatchRoster, type EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import { getPublicPlayerRecord } from "@/lib/players/public-record";
import { getStatsLeaderboard } from "./leaderboard-query";
import { adaptStatsEvidence, type StatsPlayerBinding } from "./evidence-adapter";
import { buildTournamentResults } from "./results";
import { buildTeamRatings } from "./team-rating";
import { classifyVetoSample } from "./veto-sample";

export interface TournamentStatsScope { seasonId: string; stage?: string; format?: "bo1" | "bo3" | "bo5"; mapFilter?: string; teamFilter?: string }

type StatsEvidenceScope = Omit<TournamentStatsScope, "seasonId"> & { seasonId?: string };

export interface PlayerStatsEventOption {
  id: string;
  slug: string;
  name: string;
  maps: string[];
}

type StatsLabels = { teams: Record<string, string>; players: Record<string, string> };

async function loadStatsEvidence(tx: TxDb, scope: StatsEvidenceScope, options: { mapName?: string; teamId?: string; matchIds?: readonly string[] } = {}) {
  const selectedMapRows = options.mapName && options.matchIds?.length !== 0
    ? await tx.select({ match: matches, map: matchMaps }).from(matchMaps).innerJoin(matches, eq(matches.id, matchMaps.matchId)).where(and(
      scope.seasonId ? eq(matches.seasonId, scope.seasonId) : undefined,
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
      ? options.matchIds.length ? await tx.select().from(matches).where(and(
        inArray(matches.id, [...options.matchIds]),
        scope.seasonId ? eq(matches.seasonId, scope.seasonId) : undefined,
        scope.stage ? eq(matches.stage, scope.stage) : undefined,
        scope.format ? eq(matches.format, scope.format) : undefined,
      )) : []
      : scope.seasonId ? await tx.select().from(matches).where(and(
        eq(matches.seasonId, scope.seasonId),
        scope.stage ? eq(matches.stage, scope.stage) : undefined,
        scope.format ? eq(matches.format, scope.format) : undefined,
      )) : [];
  const selectedTeamId = options.teamId ?? scope.teamFilter;
  const baseMatches = matchRows.filter((match) => match.status !== "cancelled");
  const scopedMatches = baseMatches.filter((match) => !selectedTeamId || [match.entryAId, match.entryBId].includes(selectedTeamId));
  const matchesById = new Map(scopedMatches.map((match) => [match.id, match]));
  const matchIds = scopedMatches.map((match) => match.id);
  const seasonIds = scope.seasonId ? [scope.seasonId] : [...new Set(scopedMatches.map((match) => match.seasonId))];
  const entries = seasonIds.length ? await tx.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries)
    .where(inArray(competitionEntries.competitionId, seasonIds)) : [];
  const participantIds = new Set(baseMatches.filter((match) => match.status === "finished").flatMap((match) => [match.entryAId, match.entryBId].filter((id): id is string => Boolean(id))));
  const participantEntries = entries.filter((entry) => participantIds.has(entry.id));
  const maps = selectedMapRows
    ? selectedMapRows.filter(({ match }) => matchesById.has(match.id)).map(({ map }) => map)
    : matchIds.length ? await tx.select().from(matchMaps).where(inArray(matchMaps.matchId, matchIds)) : [];
  const mapNameFilter = options.mapName ?? scope.mapFilter;
  const scopedMaps = maps.filter((map) => !mapNameFilter || map.mapName === mapNameFilter);
  const roster = await loadEffectiveMatchRoster(tx, matchIds);
  const rosterByMatchId = new Map<string, EffectiveMatchRosterPlayer[]>();
  const rosterByMatchAndUser = new Map<string, Map<string, EffectiveMatchRosterPlayer>>();
  for (const member of roster) {
    const matchRoster = rosterByMatchId.get(member.matchId) ?? [];
    matchRoster.push(member);
    rosterByMatchId.set(member.matchId, matchRoster);
    const membersByUser = rosterByMatchAndUser.get(member.matchId) ?? new Map<string, EffectiveMatchRosterPlayer>();
    if (!membersByUser.has(member.userId)) membersByUser.set(member.userId, member);
    rosterByMatchAndUser.set(member.matchId, membersByUser);
  }

  type ImportMetadata = Pick<typeof matchDemoImports.$inferSelect, "id" | "matchMapId" | "semanticProfile" | "status" | "evidenceRevision" | "createdAt">;
  const imports = scopedMaps.length
    ? await tx.select({
      id: matchDemoImports.id,
      matchMapId: matchDemoImports.matchMapId,
      semanticProfile: matchDemoImports.semanticProfile,
      status: matchDemoImports.status,
      evidenceRevision: matchDemoImports.evidenceRevision,
      createdAt: matchDemoImports.createdAt,
    }).from(matchDemoImports).where(inArray(matchDemoImports.matchMapId, scopedMaps.map((map) => map.id)))
      .orderBy(desc(matchDemoImports.createdAt), desc(matchDemoImports.id))
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
    if (!current || !match || current.status !== "confirmed" || match.status !== "finished" || !map.completedAt || map.scoreA === null || map.scoreB === null) return [];
    if (current.evidenceRevision !== buildEvidenceRevisionForTarget({ match, map, roster: rosterByMatchId.get(match.id) ?? [] })) return [];
    return [{ current, match, map }];
  });
  const currentImportIds = currentRefs.map(({ current }) => current.id);
  const payloadRows = currentImportIds.length
    ? await tx.select({ id: matchDemoImports.id, payload: matchDemoImports.payload }).from(matchDemoImports).where(inArray(matchDemoImports.id, currentImportIds))
    : [];
  const payloadByImportId = new Map(payloadRows.map((row) => [row.id, row.payload]));
  const selected = currentRefs.map(({ current, match, map }) => {
    const payload = payloadByImportId.get(current.id);
    if (payload === undefined) throw new Error("Selected stats evidence payload unavailable");
    const evidence = parseRivalHubDemoEvidenceV1(payload);
    if (evidence.target.matchMapId !== map.id || evidence.target.matchId !== match.id || evidence.target.seasonId !== match.seasonId || evidence.contract.semanticProfile !== current.semanticProfile) throw new Error("Stats evidence target mismatch");
    return { evidence, match, map, importId: current.id };
  });
  const resolutions = await resolveGameplayUsersBySteam64(tx, selected.flatMap(({ evidence }) => evidence.participants.map((participant) => participant.steamId64)));
  const facts = selected.map(({ evidence, match, importId }) => {
    const bindings = new Map<string, StatsPlayerBinding>();
    for (const participant of evidence.participants) {
      const resolution = resolutions.get(participant.steamId64);
      if (!resolution) throw new Error("Stats evidence identity unavailable");
      const member = rosterByMatchAndUser.get(match.id)?.get(resolution.userId);
      if (!member) throw new Error("Stats evidence identity unavailable");
      bindings.set(participant.steamId64, { userId: resolution.userId, entryId: member.entryId });
    }
    return { importId, facts: adaptStatsEvidence(evidence, bindings) };
  });
  const userIds = [...new Set([...resolutions.values()].map((row) => row.userId))];
  const identities = userIds.length ? await tx.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName })
    .from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(inArray(users.id, userIds)) : [];
  const labels: StatsLabels = {
    teams: Object.fromEntries(entries.map((entry) => [entry.id, entry.name])),
    players: Object.fromEntries(identities.map((user) => [user.id, getPublicDisplayName(user)])),
  };
  return {
    matches: scopedMatches,
    matchIds,
    entries,
    participantEntries,
    maps,
    scopedMaps,
    roster,
    selected: facts,
    labels,
  };
}

async function loadPlayerAppearanceScope(
  tx: TxDb,
  playerId: string,
  filters: Partial<Pick<TournamentStatsScope, "seasonId" | "stage" | "format">> = {},
) {
  const candidates = await tx.select({
    matchId: matches.id,
    seasonId: seasons.id,
    eventSlug: seasons.slug,
    eventName: seasons.name,
  }).from(matchRosterPlayers)
    .innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .innerJoin(matches, eq(matches.id, matchRosters.matchId))
    .innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(and(
      eq(eventRosterMembers.userId, playerId),
      eq(matchRosterPlayers.isStarter, true),
      inArray(matchRosters.status, ["submitted", "confirmed"]),
      eq(matches.status, "finished"),
      ne(seasons.status, "draft"),
      filters.seasonId ? eq(matches.seasonId, filters.seasonId) : undefined,
      filters.stage ? eq(matches.stage, filters.stage) : undefined,
      filters.format ? eq(matches.format, filters.format) : undefined,
    ));
  const candidateIds = [...new Set(candidates.map((row) => row.matchId))];
  const effectiveRoster = await loadEffectiveMatchRoster(tx, candidateIds);
  const effectiveMatchIds = new Set(effectiveRoster.filter((row) => row.userId === playerId).map((row) => row.matchId));
  const appearances = [...new Map(candidates.filter((row) => effectiveMatchIds.has(row.matchId)).map((row) => [row.matchId, row])).values()];
  const matchIds = appearances.map((row) => row.matchId);
  const mapRows = matchIds.length
    ? await tx.select({ matchId: matchMaps.matchId, mapName: matchMaps.mapName }).from(matchMaps).where(inArray(matchMaps.matchId, matchIds))
    : [];
  const mapsBySeason = new Map<string, Set<string>>();
  const matchIdsBySeason = new Map<string, Set<string>>();
  for (const appearance of appearances) {
    mapsBySeason.set(appearance.seasonId, mapsBySeason.get(appearance.seasonId) ?? new Set());
    const ids = matchIdsBySeason.get(appearance.seasonId) ?? new Set<string>();
    ids.add(appearance.matchId);
    matchIdsBySeason.set(appearance.seasonId, ids);
  }
  const eventByMatchId = new Map(appearances.map((row) => [row.matchId, row.seasonId]));
  for (const row of mapRows) {
    const seasonId = eventByMatchId.get(row.matchId);
    if (seasonId) mapsBySeason.get(seasonId)?.add(row.mapName);
  }
  const eventsById = new Map<string, PlayerStatsEventOption>();
  for (const appearance of appearances) {
    if (!eventsById.has(appearance.seasonId)) eventsById.set(appearance.seasonId, {
      id: appearance.seasonId,
      slug: appearance.eventSlug,
      name: appearance.eventName,
      maps: [...(mapsBySeason.get(appearance.seasonId) ?? [])].sort(),
    });
  }
  return {
    matchIds,
    events: [...eventsById.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    matchIdsBySeason,
  };
}

function buildVetoSelection(
  entries: Array<{ id: string; name: string }>,
  veto: Array<{ mapName: string; action: string; entryId: string | null }>,
  mapNames: readonly string[],
  selectedMap?: string,
) {
  const vetoByMapName = new Map<string, typeof veto>();
  for (const row of veto) {
    const rows = vetoByMapName.get(row.mapName) ?? [];
    rows.push(row);
    vetoByMapName.set(row.mapName, rows);
  }
  return [...new Set([...mapNames, ...vetoByMapName.keys()])]
    .filter((mapName) => !selectedMap || mapName === selectedMap)
    .sort()
    .map((mapName) => {
      const rows = vetoByMapName.get(mapName) ?? [];
      let picks = 0;
      let bans = 0;
      let deciders = 0;
      const teamsByEntry = new Map<string, { picks: number; bans: number }>();
      for (const row of rows) {
        if (row.action === "pick") picks += 1;
        if (row.action === "ban") bans += 1;
        if (row.action === "decider") deciders += 1;
        if ((row.action === "pick" || row.action === "ban") && row.entryId) {
          const team = teamsByEntry.get(row.entryId) ?? { picks: 0, bans: 0 };
          if (row.action === "pick") team.picks += 1;
          else team.bans += 1;
          teamsByEntry.set(row.entryId, team);
        }
      }
      return {
        mapName,
        picks,
        bans,
        deciders,
        teams: entries.map((entry) => ({ entryId: entry.id, name: entry.name, ...(teamsByEntry.get(entry.id) ?? { picks: 0, bans: 0 }) })),
      };
    });
}

async function loadScopedVetoRows(
  tx: TxDb,
  scope: Pick<TournamentStatsScope, "seasonId" | "stage" | "format">,
  mapName?: string,
) {
  return tx.select({
    matchId: matchVetoSteps.matchId,
    mapName: matchVetoSteps.mapName,
    action: matchVetoSteps.actionType,
    entryId: matchVetoSteps.entryId,
  }).from(matchVetoSteps).innerJoin(matches, eq(matches.id, matchVetoSteps.matchId)).where(and(
    eq(matches.seasonId, scope.seasonId),
    eq(matches.status, "finished"),
    scope.stage ? eq(matches.stage, scope.stage) : undefined,
    scope.format ? eq(matches.format, scope.format) : undefined,
    mapName ? eq(matchVetoSteps.mapName, mapName) : undefined,
  ));
}

async function loadVetoData(tx: TxDb, scope: Pick<TournamentStatsScope, "seasonId" | "stage" | "format">, entries: Array<{ id: string; name: string }>) {
  const matchRows = await tx.select({
    id: matches.id,
    status: matches.status,
    isForfeit: matches.isForfeit,
    entryAId: matches.entryAId,
    entryBId: matches.entryBId,
  }).from(matches).where(and(
    eq(matches.seasonId, scope.seasonId),
    scope.stage ? eq(matches.stage, scope.stage) : undefined,
    scope.format ? eq(matches.format, scope.format) : undefined,
  ));
  const finished = matchRows.filter((match) => match.status === "finished");
  const finishedIds = finished.map((match) => match.id);
  const allVeto = finishedIds.length
    ? await tx.select({
      matchId: matchVetoSteps.matchId,
      mapName: matchVetoSteps.mapName,
      action: matchVetoSteps.actionType,
      entryId: matchVetoSteps.entryId,
    }).from(matchVetoSteps).where(inArray(matchVetoSteps.matchId, finishedIds))
    : [];
  const recordedMatchIds = new Set(allVeto.map((row) => row.matchId));
  const sampleStateByMatchId = new Map(finished.map((match) => [
    match.id,
    classifyVetoSample(match, recordedMatchIds.has(match.id)),
  ]));
  const applicableMatches = finished.filter((match) => sampleStateByMatchId.get(match.id) !== "not_applicable");
  const applicableIds = new Set(applicableMatches.map((match) => match.id));
  const rows = allVeto.filter((row) => applicableIds.has(row.matchId));
  const participantIds = new Set(finished.flatMap((match) => [match.entryAId, match.entryBId].filter((id): id is string => Boolean(id))));
  const participants = entries.filter((entry) => participantIds.has(entry.id));
  const recordedApplicableIds = new Set(rows.map((row) => row.matchId));
  const teams = participants.map((entry) => ({
    entryId: entry.id,
    name: entry.name,
    vetoes: applicableMatches.filter((match) => recordedApplicableIds.has(match.id) && (match.entryAId === entry.id || match.entryBId === entry.id)).length,
  }));
  return {
    rows: rows.map(({ mapName, action, entryId }) => ({ mapName, action, entryId })),
    participants,
    teams,
    sample: {
      finishedMatches: finished.length,
      applicableMatches: applicableMatches.length,
      recordedMatches: recordedApplicableIds.size,
      missingMatches: [...sampleStateByMatchId.values()].filter((state) => state === "missing").length,
      notApplicableMatches: [...sampleStateByMatchId.values()].filter((state) => state === "not_applicable").length,
    },
  };
}

type PerformanceEvidenceFacts = Awaited<ReturnType<typeof loadStatsEvidence>>["selected"][number]["facts"]["performance"];

export function scopePerformanceFactsToTeam(facts: PerformanceEvidenceFacts, teamId: string): PerformanceEvidenceFacts {
  return {
    ...facts,
    playerRounds: facts.playerRounds.filter((fact) => fact.teamEntityKey === teamId),
    objectives: facts.objectives.filter((fact) => fact.teamEntityKey === teamId),
    playerWeapons: facts.playerWeapons.filter((fact) => fact.teamEntityKey === teamId),
  };
}

function performanceFactsForScope(
  loaded: Awaited<ReturnType<typeof loadStatsEvidence>>,
  teamId?: string,
) {
  return loaded.selected.map((row) => teamId ? scopePerformanceFactsToTeam(row.facts.performance, teamId) : row.facts.performance);
}

function indexStatsRows<T>(rows: readonly T[], key: (row: T) => string) {
  const index = new Map<string, T>();
  for (const row of rows) index.set(key(row), row);
  return index;
}

function aggregateEvidenceByMap(
  selected: Awaited<ReturnType<typeof loadStatsEvidence>>["selected"],
  labels: StatsLabels,
  options: { indexPlayers?: boolean } = {},
) {
  const grouped = new Map<string, typeof selected>();
  for (const row of selected) {
    const mapName = row.facts.tournament.mapName;
    const rows = grouped.get(mapName) ?? [];
    rows.push(row);
    grouped.set(mapName, rows);
  }
  return [...grouped].map(([mapName, rows]) => {
    const analytics = buildTournamentAnalytics(rows.map((row) => row.facts.tournament), { labels });
    const performance = buildTournamentPerformanceAnalytics(rows.map((row) => row.facts.performance), { labels });
    return {
      mapName,
      analytics,
      performance,
      analyticsTeams: indexStatsRows(analytics.teams, (row) => row.team.entityKey),
      performanceTeams: indexStatsRows(performance.teams, (row) => row.team.entityKey),
      performancePlayers: options.indexPlayers ? indexStatsRows(performance.players, (row) => row.player.entityKey) : undefined,
    };
  });
}

function resultMatchesForMapScope<T extends { id: string }>(
  matches: readonly T[],
  scopedMaps: readonly { matchId: string }[],
  mapFilter?: string,
): T[] {
  if (!mapFilter) return [...matches];
  const scopedMatchIds = new Set(scopedMaps.map((map) => map.matchId));
  return matches.filter((match) => scopedMatchIds.has(match.id));
}

function buildCoverage(
  loaded: Awaited<ReturnType<typeof loadStatsEvidence>>,
  results = buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries),
) {
  const detailedByMapName = new Map<string, number>();
  for (const row of loaded.selected) detailedByMapName.set(row.facts.tournament.mapName, (detailedByMapName.get(row.facts.tournament.mapName) ?? 0) + 1);
  return {
    detailedMaps: loaded.selected.length,
    completedMaps: results.totals.completedMaps,
    maps: results.maps.map((row) => ({ mapName: row.mapName, completedMaps: row.played, detailedMaps: detailedByMapName.get(row.mapName) ?? 0 })),
  };
}

export async function getTournamentStats(scope: TournamentStatsScope, database: DB = db) {
  return database.transaction(async (tx) => {
    const loaded = await loadStatsEvidence(tx, scope);
    const veto = await loadVetoData(tx, scope, loaded.entries);
    const results = buildTournamentResults(resultMatchesForMapScope(loaded.matches, loaded.scopedMaps, scope.mapFilter), loaded.scopedMaps, loaded.entries);
    const coverage = buildCoverage(loaded, results);
    const mapNames = [...new Set([...loaded.maps.map((map) => map.mapName), ...veto.rows.map((row) => row.mapName)])].sort();
    const leaderboard = await getStatsLeaderboard(scope, loaded.selected.map((row) => row.importId), loaded.roster, tx);
    return {
      leaderboard,
      teamRatings: buildTeamRatings(leaderboard),
      analytics: buildTournamentAnalytics(loaded.selected.map((row) => row.facts.tournament), { labels: loaded.labels }),
      performance: buildTournamentPerformanceAnalytics(performanceFactsForScope(loaded, scope.teamFilter), { labels: loaded.labels }),
      results,
      selection: buildVetoSelection(veto.participants, veto.rows, mapNames, scope.mapFilter),
      veto: { teams: veto.teams, sample: veto.sample },
      coverage,
      options: { teams: loaded.participantEntries, maps: mapNames },
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function loadTournamentPlayerDetail(
  tx: TxDb,
  scope: StatsEvidenceScope & { playerId: string },
  matchIds: readonly string[],
  options: { requireCurrentImports?: boolean } = {},
) {
  const loaded = await loadStatsEvidence(tx, scope, { matchIds });
  const [scoreboard, scoreboardMaps] = await Promise.all([
    getStatsLeaderboard(scope, loaded.selected.map((row) => row.importId), loaded.roster, tx, { userId: scope.playerId, groupByTeam: false, requireCurrentImports: options.requireCurrentImports }),
    getStatsLeaderboard(scope, loaded.selected.map((row) => row.importId), loaded.roster, tx, { userId: scope.playerId, groupByMap: true, groupByTeam: false, requireCurrentImports: options.requireCurrentImports }),
  ]);
  const performance = buildTournamentPerformanceAnalytics(loaded.selected.map((row) => row.facts.performance), { labels: loaded.labels });
  const detail = indexStatsRows(performance.players, (row) => row.player.entityKey).get(scope.playerId) ?? null;
  const maps = aggregateEvidenceByMap(loaded.selected, loaded.labels, { indexPlayers: true }).map((row) => ({
    mapName: row.mapName,
    performance: row.performancePlayers?.get(scope.playerId) ?? null,
  }));
  const results = buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries);
  const record = await getPublicPlayerRecord(scope.playerId, { seasonId: scope.seasonId, matchIds, database: tx });
  const [mvpRow] = matchIds.length ? await tx.select({ count: count() }).from(matches).where(and(
    eq(matches.mvpWinnerUserId, scope.playerId),
    eq(matches.status, "finished"),
    scope.seasonId ? eq(matches.seasonId, scope.seasonId) : undefined,
    inArray(matches.id, [...matchIds]),
  )) : [];
  const completedMaps = loaded.scopedMaps.filter((map) => map.completedAt !== null && map.scoreA !== null && map.scoreB !== null);
  const rounds = completedMaps.reduce((sum, map) => sum + map.scoreA! + map.scoreB!, 0);
  return {
    playerId: scope.playerId,
    scoreboard,
    scoreboardMaps,
    performance: detail,
    maps,
    coverage: buildCoverage(loaded, results),
    summary: {
      matches: record.played,
      wins: record.wins,
      losses: record.losses,
      mvp: mvpRow?.count ?? 0,
      maps: completedMaps.length,
      rounds,
    },
  };
}

export async function getTournamentPerformancePlayers(scope: TournamentStatsScope, database: DB = db) {
  return database.transaction(async (tx) => {
    const loaded = await loadStatsEvidence(tx, scope);
    return buildTournamentPerformanceAnalytics(
      loaded.selected.map((row) => row.facts.performance),
      { labels: loaded.labels },
    ).players;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getTournamentPlayerDetail(scope: TournamentStatsScope & { playerId: string }, database: DB = db) {
  return database.transaction(async (tx) => {
    const playerScope = await loadPlayerAppearanceScope(tx, scope.playerId, scope);
    return loadTournamentPlayerDetail(tx, scope, playerScope.matchIds);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getPlayerCareerDetail(
  scope: { playerId: string; eventSlug?: string; mapFilter?: string },
  database: DB = db,
) {
  return database.transaction(async (tx) => {
    const playerScope = await loadPlayerAppearanceScope(tx, scope.playerId);
    const event = scope.eventSlug ? playerScope.events.find((candidate) => candidate.slug === scope.eventSlug) : undefined;
    const allMaps = new Set(playerScope.events.flatMap((candidate) => candidate.maps));
    const allowedMaps = event ? new Set(event.maps) : allMaps;
    const mapFilter = scope.mapFilter && allowedMaps.has(scope.mapFilter) ? scope.mapFilter : undefined;
    const matchIds = event
      ? [...(playerScope.matchIdsBySeason.get(event.id) ?? [])]
      : playerScope.matchIds;
    const detail = await loadTournamentPlayerDetail(tx, { playerId: scope.playerId, seasonId: event?.id, mapFilter }, matchIds, { requireCurrentImports: true });
    return { ...detail, events: playerScope.events, selectedEvent: event ?? null, mapFilter };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}


function remapLinkedTeamFacts(
  selected: Awaited<ReturnType<typeof loadStatsEvidence>>["selected"],
  linkedEntryIds: ReadonlySet<string>,
  teamId: string,
) {
  const remap = (entryId: string) => linkedEntryIds.has(entryId) ? teamId : entryId;
  return selected.map((row) => ({
    ...row,
    facts: {
      tournament: {
        ...row.facts.tournament,
        teamEntityKeys: {
          teamA: remap(row.facts.tournament.teamEntityKeys.teamA),
          teamB: remap(row.facts.tournament.teamEntityKeys.teamB),
        },
        playerWeapons: row.facts.tournament.playerWeapons.map((fact) => ({ ...fact, teamEntityKey: remap(fact.teamEntityKey) })),
      },
      performance: {
        ...row.facts.performance,
        teamEntityKeys: {
          teamA: remap(row.facts.performance.teamEntityKeys.teamA),
          teamB: remap(row.facts.performance.teamEntityKeys.teamB),
        },
        playerRounds: row.facts.performance.playerRounds.map((fact) => ({ ...fact, teamEntityKey: remap(fact.teamEntityKey) })),
        objectives: row.facts.performance.objectives.map((fact) => ({ ...fact, teamEntityKey: fact.teamEntityKey ? remap(fact.teamEntityKey) : null })),
        playerWeapons: row.facts.performance.playerWeapons.map((fact) => ({ ...fact, teamEntityKey: remap(fact.teamEntityKey) })),
      },
    },
  }));
}

/**
 * Canonical all-time Team projection.
 *
 * Long Team identity is projected only at analytics time: immutable Evidence and
 * CompetitionEntry identities stay untouched. The match corpus is narrowed from
 * public linked entries first, then current-confirmed Evidence is selected once.
 */
export async function getLongTeamCareerDetail(teamId: string, database: DB = db) {
  return database.transaction(async (tx) => {
    const linkedEntries = await tx.select({
      id: competitionEntries.id,
      name: competitionEntries.name,
      seasonId: competitionEntries.competitionId,
      seasonSlug: seasons.slug,
      seasonName: seasons.name,
    }).from(competitionEntries)
      .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
      .where(and(
        eq(competitionEntries.teamId, teamId),
        ne(seasons.status, "draft"),
        publicCompetitionEntryCondition(),
      ));
    const linkedEntryIds = new Set(linkedEntries.map((entry) => entry.id));
    if (!linkedEntryIds.size) return {
      teamId,
      linkedEntries,
      results: { played: 0, wins: 0, losses: 0, maps: 0, mapWins: 0, mapLosses: 0 },
      analytics: null,
      economyMatrix: [],
      performance: null,
      scoreboard: [],
      teamRating: null,
      detailedPlayers: [],
      selection: [],
      maps: [],
      coverage: { detailedMaps: 0, completedMaps: 0, maps: [] },
    };

    const appearanceMatches = await tx.select({ id: matches.id }).from(matches).where(and(
      eq(matches.status, "finished"),
      or(inArray(matches.entryAId, [...linkedEntryIds]), inArray(matches.entryBId, [...linkedEntryIds])),
    ));
    const matchIds = appearanceMatches.map((match) => match.id);
    const loaded = await loadStatsEvidence(tx, {}, { matchIds });
    const remapped = remapLinkedTeamFacts(loaded.selected, linkedEntryIds, teamId);
    const labels: StatsLabels = {
      ...loaded.labels,
      teams: { ...loaded.labels.teams, [teamId]: linkedEntries[0]?.name ?? teamId },
    };
    const analytics = buildTournamentAnalytics(remapped.map((row) => row.facts.tournament), { labels });
    const performance = buildTournamentPerformanceAnalytics(performanceFactsForScope({ ...loaded, selected: remapped }, teamId), { labels });
    const teamAnalytics = analytics.teams.find((row) => row.team.entityKey === teamId) ?? null;
    const teamPerformance = performance.teams.find((row) => row.team.entityKey === teamId) ?? null;

    const resultFacts = buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries);
    const ownResults = resultFacts.teams.filter((row) => linkedEntryIds.has(row.entryId));
    const mapRows = resultFacts.teamMaps.flatMap((map) => map.teams
      .filter((row) => linkedEntryIds.has(row.entryId))
      .map((row) => ({ mapName: map.mapName, ...row })));
    const mapResults = new Map<string, { played: number; wins: number; losses: number }>();
    for (const row of mapRows) {
      const current = mapResults.get(row.mapName) ?? { played: 0, wins: 0, losses: 0 };
      current.played += row.played;
      current.wins += row.wins;
      current.losses += row.losses;
      mapResults.set(row.mapName, current);
    }

    const linkedRoster = loaded.roster.filter((row) => linkedEntryIds.has(row.entryId));
    const scoreboard = await getStatsLeaderboard(
      {},
      loaded.selected.map((row) => row.importId),
      linkedRoster,
      tx,
      { groupByTeam: false, requireCurrentImports: true, requireRosterMatch: true },
    );
    const teamRating = buildTeamRatings(scoreboard.map((row) => ({ ...row, teamId })))[0] ?? null;
    const vetoRows = matchIds.length ? await tx.select({
      mapName: matchVetoSteps.mapName,
      action: matchVetoSteps.actionType,
      entryId: matchVetoSteps.entryId,
    }).from(matchVetoSteps).where(inArray(matchVetoSteps.matchId, matchIds)) : [];
    const remappedVeto = vetoRows.map((row) => ({
      ...row,
      entryId: row.entryId && linkedEntryIds.has(row.entryId) ? teamId : row.entryId,
    }));
    const selection = buildVetoSelection(
      [{ id: teamId, name: labels.teams[teamId] ?? teamId }],
      remappedVeto,
      [...new Set([...loaded.maps.map((map) => map.mapName), ...remappedVeto.map((row) => row.mapName)])],
    );
    const analyticsByMap = aggregateEvidenceByMap(remapped, labels, { indexPlayers: true });
    const coverage = buildCoverage({ ...loaded, selected: remapped }, resultFacts);
    const coverageByMap = new Map(coverage.maps.map((row) => [row.mapName, row]));
    const maps = [...new Set([...mapResults.keys(), ...analyticsByMap.map((row) => row.mapName)])].sort().map((mapName) => {
      const detail = analyticsByMap.find((row) => row.mapName === mapName);
      return {
        mapName,
        results: mapResults.get(mapName) ?? null,
        coverage: coverageByMap.get(mapName) ?? { mapName, completedMaps: 0, detailedMaps: 0 },
        analytics: detail?.analyticsTeams.get(teamId) ?? null,
        performance: detail?.performanceTeams.get(teamId) ?? null,
      };
    });
    const played = ownResults.reduce((sum, row) => sum + row.matches, 0);
    const wins = ownResults.reduce((sum, row) => sum + row.matchWins, 0);
    const losses = ownResults.reduce((sum, row) => sum + row.matchLosses, 0);
    const mapWins = [...mapResults.values()].reduce((sum, row) => sum + row.wins, 0);
    const mapLosses = [...mapResults.values()].reduce((sum, row) => sum + row.losses, 0);

    return {
      teamId,
      linkedEntries,
      results: { played, wins, losses, maps: mapWins + mapLosses, mapWins, mapLosses },
      analytics: teamAnalytics,
      economyMatrix: analytics.economyMatrix,
      performance: teamPerformance,
      scoreboard,
      teamRating,
      detailedPlayers: performance.players.filter((row) => row.teamEntityKeys.includes(teamId)),
      selection,
      maps,
      coverage,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getTournamentTeamDetail(scope: TournamentStatsScope & { teamId: string }, database: DB = db) {
  return database.transaction(async (tx) => {
    const loaded = await loadStatsEvidence(tx, scope, { teamId: scope.teamId });
    const veto = await loadVetoData(tx, scope, loaded.entries);
    const results = buildTournamentResults(resultMatchesForMapScope(loaded.matches, loaded.scopedMaps, scope.mapFilter), loaded.scopedMaps, loaded.entries);
    const analytics = buildTournamentAnalytics(loaded.selected.map((row) => row.facts.tournament), { labels: loaded.labels });
    const performance = buildTournamentPerformanceAnalytics(performanceFactsForScope(loaded, scope.teamId), { labels: loaded.labels });
    const scoreboard = await getStatsLeaderboard({ ...scope, teamFilter: scope.teamId }, loaded.selected.map((row) => row.importId), loaded.roster, tx);
    const teamRating = buildTeamRatings(scoreboard).find((row) => row.entryId === scope.teamId) ?? null;
    const analyticsByMapName = new Map<string, ReturnType<typeof aggregateEvidenceByMap>[number]>();
    for (const row of aggregateEvidenceByMap(loaded.selected, loaded.labels)) analyticsByMapName.set(row.mapName, row);
    const resultByMapName = new Map<string, { entryId: string; played: number; wins: number; losses: number }>();
    for (const map of results.teamMaps) {
      for (const team of map.teams) {
        if (team.entryId === scope.teamId) resultByMapName.set(map.mapName, { entryId: team.entryId, played: team.played, wins: team.wins, losses: team.losses });
      }
    }
    const selection = buildVetoSelection(veto.participants, veto.rows, [...new Set([...loaded.maps.map((map) => map.mapName), ...veto.rows.map((row) => row.mapName)])], scope.mapFilter);
    const coverage = buildCoverage(loaded, results);
    const coverageByMapName = new Map(coverage.maps.map((row) => [row.mapName, row]));
    const selectionByMapName = new Map<string, { picks: number; bans: number }>();
    for (const map of selection) {
      for (const team of map.teams) {
        if (team.entryId === scope.teamId) selectionByMapName.set(map.mapName, team);
      }
    }
    const teamAnalytics = indexStatsRows(analytics.teams, (row) => row.team.entityKey);
    const teamPerformance = indexStatsRows(performance.teams, (row) => row.team.entityKey);
    const mapNames = new Set([...resultByMapName.keys(), ...analyticsByMapName.keys(), ...selectionByMapName.keys()]);
    const maps = [...mapNames].map((mapName) => {
      const analyticsForMap = analyticsByMapName.get(mapName);
      const selectionForMap = selectionByMapName.get(mapName);
      return {
        mapName,
        results: resultByMapName.get(mapName) ?? null,
        selection: selectionForMap ?? null,
        coverage: coverageByMapName.get(mapName) ?? { mapName, completedMaps: 0, detailedMaps: 0 },
        analytics: analyticsForMap?.analyticsTeams.get(scope.teamId) ?? null,
        performance: analyticsForMap?.performanceTeams.get(scope.teamId) ?? null,
      };
    });
    return {
      teamId: scope.teamId,
      results: results.teams.find((row) => row.entryId === scope.teamId) ?? null,
      selection,
      analytics: teamAnalytics.get(scope.teamId) ?? null,
      economyMatrix: analytics.economyMatrix,
      performance: teamPerformance.get(scope.teamId) ?? null,
      scoreboard,
      teamRating,
      detailedPlayers: performance.players.filter((row) => row.teamEntityKeys.includes(scope.teamId)),
      maps,
      coverage,
      entries: loaded.entries,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getTournamentMapDetail(scope: Omit<TournamentStatsScope, "mapFilter" | "teamFilter"> & { map: string }, database: DB = db) {
  return database.transaction(async (tx) => {
    const loaded = await loadStatsEvidence(tx, scope, { mapName: scope.map });
    const vetoRows = await loadScopedVetoRows(tx, scope, scope.map);
    const results = buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries);
    const analytics = buildTournamentAnalytics(loaded.selected.map((row) => row.facts.tournament), { labels: loaded.labels });
    const performance = buildTournamentPerformanceAnalytics(loaded.selected.map((row) => row.facts.performance), { labels: loaded.labels });
    return {
      map: scope.map,
      results,
      selection: buildVetoSelection([], vetoRows.map(({ mapName, action, entryId }) => ({ mapName, action, entryId })), [scope.map], scope.map),
      coverage: buildCoverage(loaded, results),
      analytics,
      performance,
      entries: loaded.entries,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export type TournamentStats = Awaited<ReturnType<typeof getTournamentStats>>;
export type TournamentPlayerDetail = Awaited<ReturnType<typeof getTournamentPlayerDetail>>;
export type TournamentTeamDetail = Awaited<ReturnType<typeof getTournamentTeamDetail>>;
export type LongTeamCareerDetail = Awaited<ReturnType<typeof getLongTeamCareerDetail>>;
export type TournamentMapDetail = Awaited<ReturnType<typeof getTournamentMapDetail>>;
