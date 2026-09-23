import "server-only";

import { and, desc, eq, inArray, or } from "drizzle-orm";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { db, type DB, type TxDb } from "@/db/client";
import { competitionEntries, matchDemoImports, matchMaps, matches, matchVetoSteps, steamProfiles, users } from "@/db/schema";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { resolveGameplayUsersBySteam64 } from "@/lib/identity/gameplay-steam";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { loadEffectiveMatchRoster, type EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import { getStatsLeaderboard } from "./leaderboard-query";
import { adaptStatsEvidence, type StatsPlayerBinding } from "./evidence-adapter";
import { buildTournamentResults } from "./results";

export interface TournamentStatsScope { seasonId: string; stage?: string; mapFilter?: string; teamFilter?: string }

type StatsLabels = { teams: Record<string, string>; players: Record<string, string> };

async function loadStatsEvidence(tx: TxDb, scope: TournamentStatsScope, options: { mapName?: string; teamId?: string } = {}) {
  const selectedMapRows = options.mapName
    ? await tx.select({ match: matches, map: matchMaps }).from(matchMaps).innerJoin(matches, eq(matches.id, matchMaps.matchId)).where(and(
      eq(matches.seasonId, scope.seasonId),
      eq(matchMaps.mapName, options.mapName),
      scope.stage ? eq(matches.stage, scope.stage) : undefined,
      (options.teamId ?? scope.teamFilter) ? or(eq(matches.entryAId, options.teamId ?? scope.teamFilter!), eq(matches.entryBId, options.teamId ?? scope.teamFilter!)) : undefined,
    ))
    : undefined;
  const matchRows = selectedMapRows
    ? [...new Map(selectedMapRows.map(({ match }) => [match.id, match])).values()]
    : await tx.select().from(matches).where(and(eq(matches.seasonId, scope.seasonId), scope.stage ? eq(matches.stage, scope.stage) : undefined));
  const selectedTeamId = options.teamId ?? scope.teamFilter;
  const scopedMatches = matchRows.filter((match) => match.status !== "cancelled" && (!selectedTeamId || [match.entryAId, match.entryBId].includes(selectedTeamId)));
  const matchesById = new Map(scopedMatches.map((match) => [match.id, match]));
  const matchIds = scopedMatches.map((match) => match.id);
  const entries = await tx.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries).where(eq(competitionEntries.competitionId, scope.seasonId));
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
    if (evidence.target.matchMapId !== map.id || evidence.target.matchId !== match.id || evidence.target.seasonId !== scope.seasonId || evidence.contract.semanticProfile !== current.semanticProfile) throw new Error("Stats evidence target mismatch");
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
    maps,
    scopedMaps,
    roster,
    selected: facts,
    labels,
  };
}

function buildVetoSelection(
  entries: Array<{ id: string; name: string }>,
  veto: Array<{ mapName: string; action: string; entryId: string | null }>,
  selectedMap?: string,
) {
  const vetoByMapName = new Map<string, typeof veto>();
  for (const row of veto) {
    const rows = vetoByMapName.get(row.mapName) ?? [];
    rows.push(row);
    vetoByMapName.set(row.mapName, rows);
  }
  return [...vetoByMapName.keys()].filter((mapName) => !selectedMap || mapName === selectedMap).sort().map((mapName) => {
    const rows = vetoByMapName.get(mapName)!;
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
      teams: entries.flatMap((entry) => {
        const counts = teamsByEntry.get(entry.id);
        return counts ? [{ entryId: entry.id, name: entry.name, ...counts }] : [];
      }),
    };
  });
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
    const veto = loaded.matchIds.length ? await tx.select({ mapName: matchVetoSteps.mapName, action: matchVetoSteps.actionType, entryId: matchVetoSteps.entryId }).from(matchVetoSteps).where(inArray(matchVetoSteps.matchId, loaded.matchIds)) : [];
    const results = buildTournamentResults(resultMatchesForMapScope(loaded.matches, loaded.scopedMaps, scope.mapFilter), loaded.scopedMaps, loaded.entries);
    const coverage = buildCoverage(loaded, results);
    return {
      leaderboard: await getStatsLeaderboard(scope, loaded.selected.map((row) => row.importId), loaded.roster, tx),
      analytics: buildTournamentAnalytics(loaded.selected.map((row) => row.facts.tournament), { labels: loaded.labels }),
      performance: buildTournamentPerformanceAnalytics(loaded.selected.map((row) => row.facts.performance), { labels: loaded.labels }),
      results,
      selection: buildVetoSelection(loaded.entries, veto, scope.mapFilter),
      coverage,
      options: { teams: loaded.entries, maps: [...new Set([...loaded.maps.map((map) => map.mapName), ...veto.map((row) => row.mapName)])].sort() },
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getTournamentPlayerDetail(scope: TournamentStatsScope & { playerId: string }, database: DB = db) {
  return database.transaction(async (tx) => {
    const loaded = await loadStatsEvidence(tx, scope);
    const [scoreboard, scoreboardMaps] = await Promise.all([
      getStatsLeaderboard(scope, loaded.selected.map((row) => row.importId), loaded.roster, tx, { userId: scope.playerId, groupByTeam: false }),
      getStatsLeaderboard(scope, loaded.selected.map((row) => row.importId), loaded.roster, tx, { userId: scope.playerId, groupByMap: true, groupByTeam: false }),
    ]);
    const performance = buildTournamentPerformanceAnalytics(loaded.selected.map((row) => row.facts.performance), { labels: loaded.labels });
    const detail = indexStatsRows(performance.players, (row) => row.player.entityKey).get(scope.playerId) ?? null;
    const maps = aggregateEvidenceByMap(loaded.selected, loaded.labels, { indexPlayers: true }).map((row) => ({
      mapName: row.mapName,
      performance: row.performancePlayers?.get(scope.playerId) ?? null,
    }));
    return { playerId: scope.playerId, scoreboard, scoreboardMaps, performance: detail, maps, coverage: buildCoverage(loaded) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getTournamentTeamDetail(scope: TournamentStatsScope & { teamId: string }, database: DB = db) {
  return database.transaction(async (tx) => {
    const loaded = await loadStatsEvidence(tx, scope, { teamId: scope.teamId });
    const veto = loaded.matchIds.length ? await tx.select({ mapName: matchVetoSteps.mapName, action: matchVetoSteps.actionType, entryId: matchVetoSteps.entryId }).from(matchVetoSteps).where(inArray(matchVetoSteps.matchId, loaded.matchIds)) : [];
    const results = buildTournamentResults(resultMatchesForMapScope(loaded.matches, loaded.scopedMaps, scope.mapFilter), loaded.scopedMaps, loaded.entries);
    const analytics = buildTournamentAnalytics(loaded.selected.map((row) => row.facts.tournament), { labels: loaded.labels });
    const performance = buildTournamentPerformanceAnalytics(loaded.selected.map((row) => row.facts.performance), { labels: loaded.labels });
    const scoreboard = await getStatsLeaderboard({ ...scope, teamFilter: scope.teamId }, loaded.selected.map((row) => row.importId), loaded.roster, tx);
    const analyticsByMapName = new Map<string, ReturnType<typeof aggregateEvidenceByMap>[number]>();
    for (const row of aggregateEvidenceByMap(loaded.selected, loaded.labels)) analyticsByMapName.set(row.mapName, row);
    const resultByMapName = new Map<string, { entryId: string; played: number; wins: number; losses: number }>();
    for (const map of results.teamMaps) {
      for (const team of map.teams) {
        if (team.entryId === scope.teamId) resultByMapName.set(map.mapName, { entryId: team.entryId, played: team.played, wins: team.wins, losses: team.losses });
      }
    }
    const selection = buildVetoSelection(loaded.entries, veto, scope.mapFilter);
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
    const veto = loaded.matchIds.length ? await tx.select({ mapName: matchVetoSteps.mapName, action: matchVetoSteps.actionType, entryId: matchVetoSteps.entryId }).from(matchVetoSteps).where(inArray(matchVetoSteps.matchId, loaded.matchIds)) : [];
    const results = buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries);
    const analytics = buildTournamentAnalytics(loaded.selected.map((row) => row.facts.tournament), { labels: loaded.labels });
    const performance = buildTournamentPerformanceAnalytics(loaded.selected.map((row) => row.facts.performance), { labels: loaded.labels });
    return { map: scope.map, results, selection: buildVetoSelection(loaded.entries, veto, scope.map), coverage: buildCoverage(loaded, results), analytics, performance, entries: loaded.entries };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export type TournamentStats = Awaited<ReturnType<typeof getTournamentStats>>;
export type TournamentPlayerDetail = Awaited<ReturnType<typeof getTournamentPlayerDetail>>;
export type TournamentTeamDetail = Awaited<ReturnType<typeof getTournamentTeamDetail>>;
export type TournamentMapDetail = Awaited<ReturnType<typeof getTournamentMapDetail>>;
