import { officialMatchCondition } from "@/lib/matches/scope";
import "server-only";

import { and, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  buildTournamentAnalytics,
  buildTournamentPerformanceAnalyticsFromProjections as buildTournamentPerformanceAnalytics,
  remapTournamentPerformanceMapProjection,
} from "@cs2dak/tournament";
import { db, type DB, type TxDb } from "@/db/client";
import {
  competitionEntries,
  eventRosterMembers,
  matchDemoStatProjections,
  matchMaps,
  matchRosterPlayers,
  matchRosters,
  matches,
  matchVetoSteps,
  seasons,
} from "@/db/schema";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import {
  loadEffectiveMatchRosterIdentities,
  type EffectiveMatchRosterIdentity,
} from "@/lib/match-rosters/effective";
import { getPublicPlayerRecord } from "@/lib/players/public-record";
import { getPlayerStatsScoreboards, getStatsLeaderboard } from "./leaderboard-query";
import { AppError, ErrorCode } from "@/lib/errors";
import { buildScopeInsights } from "./insight-facts";
import {
  buildRecords,
  collectRecordTies,
  type RecordOccurrence,
  type RecordSummary,
} from "./records";
import { RECORD_EVENT_NAMES, type RecordEventKind } from "./record-facts";
import type { RecordEventPage } from "./record-events-query";
import type { StatsTab } from "./view-state";
import type {
  PlatformStatsScope,
  PlayerStatsEventOption,
  StatsLabels,
  TournamentStatsScope,
} from "./types";
import type { Insight } from "./insights";
import { buildTournamentResults } from "./results";
import { buildTeamRatings } from "./team-rating";
import { classifyVetoSample } from "./veto-sample";
import { loadStatsContext } from "./tournament-scope";
import {
  loadStatsEvidence,
  loadStatsDetailEvidence,
  loadStatsEvidenceSelection,
  type PlayerDetailFacts,
  type ProjectionTargets,
} from "./tournament-projections";
import {
  performanceFactsForScope,
  indexStatsRows,
  groupEvidenceByMap,
  aggregateEvidenceByMap,
  resultMatchesForMapScope,
  buildCoverage,
} from "./tournament-aggregate";
export { scopePerformanceFactsToTeam } from "./tournament-aggregate";

async function loadPlayerAppearanceScopes(
  tx: TxDb,
  playerIds: readonly string[],
  filters: Partial<Pick<TournamentStatsScope, "seasonId" | "stage" | "format">> = {},
) {
  const candidates = playerIds.length
    ? await tx
        .select({
          userId: eventRosterMembers.userId,
          matchId: matches.id,
          seasonId: seasons.id,
          eventSlug: seasons.slug,
          eventName: seasons.name,
        })
        .from(matchRosterPlayers)
        .innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
        .innerJoin(
          eventRosterMembers,
          eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId),
        )
        .innerJoin(matches, eq(matches.id, matchRosters.matchId))
        .innerJoin(seasons, eq(seasons.id, matches.seasonId))
        .where(
          and(
            inArray(eventRosterMembers.userId, [...playerIds]),
            eq(matchRosterPlayers.isStarter, true),
            inArray(matchRosters.status, ["submitted", "confirmed"]),
            eq(matches.status, "finished"),
            ne(seasons.status, "draft"),
            filters.seasonId ? eq(matches.seasonId, filters.seasonId) : undefined,
            filters.stage ? eq(matches.stage, filters.stage) : undefined,
            filters.format ? eq(matches.format, filters.format) : undefined,
          ),
        )
    : [];
  const candidateIds = [...new Set(candidates.map((row) => row.matchId))];
  const effectiveRoster = await loadEffectiveMatchRosterIdentities(tx, candidateIds);
  const mapRows = candidateIds.length
    ? await tx
        .select({ matchId: matchMaps.matchId, mapName: matchMaps.mapName })
        .from(matchMaps)
        .where(inArray(matchMaps.matchId, candidateIds))
    : [];
  return new Map(
    playerIds.map((playerId) => {
      const effectiveMatchIds = new Set(
        effectiveRoster.filter((row) => row.userId === playerId).map((row) => row.matchId),
      );
      const appearances = [
        ...new Map(
          candidates
            .filter((row) => row.userId === playerId && effectiveMatchIds.has(row.matchId))
            .map((row) => [row.matchId, row]),
        ).values(),
      ];
      const matchIds = appearances.map((row) => row.matchId);
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
        if (!eventsById.has(appearance.seasonId))
          eventsById.set(appearance.seasonId, {
            id: appearance.seasonId,
            slug: appearance.eventSlug,
            name: appearance.eventName,
            maps: [...(mapsBySeason.get(appearance.seasonId) ?? [])].sort(),
          });
      }
      return [
        playerId,
        {
          matchIds,
          effectiveRoster,
          events: [...eventsById.values()].sort(
            (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
          ),
          matchIdsBySeason,
        },
      ] as const;
    }),
  );
}

async function loadPlayerAppearanceScope(
  tx: TxDb,
  playerId: string,
  filters: Partial<Pick<TournamentStatsScope, "seasonId" | "stage" | "format">> = {},
) {
  return (await loadPlayerAppearanceScopes(tx, [playerId], filters)).get(playerId)!;
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
        teams: entries.map((entry) => ({
          entryId: entry.id,
          name: entry.name,
          ...(teamsByEntry.get(entry.id) ?? { picks: 0, bans: 0 }),
        })),
      };
    });
}

async function loadScopedVetoRows(tx: TxDb, scope: PlatformStatsScope, mapName?: string) {
  return tx
    .select({
      matchId: matchVetoSteps.matchId,
      mapName: matchVetoSteps.mapName,
      action: matchVetoSteps.actionType,
      entryId: matchVetoSteps.entryId,
    })
    .from(matchVetoSteps)
    .innerJoin(matches, eq(matches.id, matchVetoSteps.matchId))
    .where(
      and(
        officialMatchCondition(),
        scope.seasonId
          ? eq(matches.seasonId, scope.seasonId)
          : scope.seasonIds
            ? inArray(matches.seasonId, scope.seasonIds)
            : undefined,
        eq(matches.status, "finished"),
        scope.stage ? eq(matches.stage, scope.stage) : undefined,
        scope.format ? eq(matches.format, scope.format) : undefined,
        mapName ? eq(matchVetoSteps.mapName, mapName) : undefined,
      ),
    );
}

function vetoActionSamples(rows: readonly { action: string; matchId: string }[]) {
  return {
    pick: new Set(rows.filter((row) => row.action === "pick").map((row) => row.matchId)).size,
    ban: new Set(rows.filter((row) => row.action === "ban").map((row) => row.matchId)).size,
  };
}

type VetoMatch = Pick<
  typeof matches.$inferSelect,
  "id" | "status" | "isForfeit" | "entryAId" | "entryBId"
>;

type VetoRow = { matchId: string; mapName: string; action: string; entryId: string | null };

async function loadVetoData(
  tx: TxDb,
  scope: PlatformStatsScope & { teamId?: string },
  entries: Array<{ id: string; name: string }>,
  remap: (id: string) => string = (id) => id,
  reusedMatches?: readonly VetoMatch[],
  reusedRows?: readonly VetoRow[],
) {
  const originalMatches =
    reusedMatches ??
    (await tx
      .select({
        id: matches.id,
        status: matches.status,
        isForfeit: matches.isForfeit,
        entryAId: matches.entryAId,
        entryBId: matches.entryBId,
      })
      .from(matches)
      .where(
        and(
          officialMatchCondition(),
          scope.seasonId
            ? eq(matches.seasonId, scope.seasonId)
            : scope.seasonIds
              ? inArray(matches.seasonId, scope.seasonIds)
              : undefined,
          scope.stage ? eq(matches.stage, scope.stage) : undefined,
          scope.format ? eq(matches.format, scope.format) : undefined,
          scope.teamId
            ? or(eq(matches.entryAId, scope.teamId), eq(matches.entryBId, scope.teamId))
            : undefined,
        ),
      ));
  const matchRows = originalMatches.map((row) => ({
    ...row,
    entryAId: row.entryAId ? remap(row.entryAId) : row.entryAId,
    entryBId: row.entryBId ? remap(row.entryBId) : row.entryBId,
  }));
  const finished = matchRows.filter((match) => match.status === "finished");
  const finishedIds = finished.map((match) => match.id);
  const allVeto = reusedRows
    ? reusedRows.filter((row) => finishedIds.includes(row.matchId))
    : finishedIds.length
      ? await tx
          .select({
            matchId: matchVetoSteps.matchId,
            mapName: matchVetoSteps.mapName,
            action: matchVetoSteps.actionType,
            entryId: matchVetoSteps.entryId,
          })
          .from(matchVetoSteps)
          .where(inArray(matchVetoSteps.matchId, finishedIds))
      : [];
  const recordedMatchIds = new Set(allVeto.map((row) => row.matchId));
  const sampleStateByMatchId = new Map(
    finished.map((match) => [match.id, classifyVetoSample(match, recordedMatchIds.has(match.id))]),
  );
  const applicableMatches = finished.filter(
    (match) => sampleStateByMatchId.get(match.id) !== "not_applicable",
  );
  const applicableIds = new Set(applicableMatches.map((match) => match.id));
  const rows = allVeto
    .filter((row) => applicableIds.has(row.matchId))
    .map((row) => ({ ...row, entryId: row.entryId ? remap(row.entryId) : null }));
  const participantIds = new Set(
    finished.flatMap((match) =>
      [match.entryAId, match.entryBId].filter((id): id is string => Boolean(id)),
    ),
  );
  const participants = entries.filter((entry) => participantIds.has(entry.id));
  const recordedApplicableIds = new Set(rows.map((row) => row.matchId));
  const teams = participants.map((entry) => ({
    entryId: entry.id,
    name: entry.name,
    vetoes: applicableMatches.filter(
      (match) =>
        recordedApplicableIds.has(match.id) &&
        (match.entryAId === entry.id || match.entryBId === entry.id),
    ).length,
  }));
  return {
    actionSamples: vetoActionSamples(rows),
    rows: rows.map(({ mapName, action, entryId }) => ({ mapName, action, entryId })),
    participants,
    teams,
    sample: {
      finishedMatches: finished.length,
      applicableMatches: applicableMatches.length,
      recordedMatches: recordedApplicableIds.size,
      missingMatches: [...sampleStateByMatchId.values()].filter((state) => state === "missing")
        .length,
      notApplicableMatches: [...sampleStateByMatchId.values()].filter(
        (state) => state === "not_applicable",
      ).length,
    },
  };
}

export async function getTournamentStats(scope: PlatformStatsScope, database: DB = db) {
  const needs = (...views: StatsTab[]) => !scope.view || views.includes(scope.view);

  const snapshot = await database.transaction(
    async (tx) => {
      if (!scope.seasonId || scope.publicOnly) {
        const publicEvents = await tx
          .select({ id: seasons.id })
          .from(seasons)
          .where(
            and(
              ne(seasons.status, "draft"),
              scope.seasonIds ? inArray(seasons.id, scope.seasonIds) : undefined,
              scope.seasonId ? eq(seasons.id, scope.seasonId) : undefined,
            ),
          );
        const ids = publicEvents.map((e) => e.id);
        if (scope.seasonId && !ids.includes(scope.seasonId))
          throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
        scope = { ...scope, seasonIds: ids };
      }
      const original = await loadStatsEvidence(tx, scope, { reuseVetoMatches: true });
      const platform = !scope.seasonId;
      const mapping = new Map(
        original.entryRows.map((row) => [row.id, platform && row.teamId ? row.teamId : row.id]),
      );
      const remap = (id: string) => mapping.get(id) ?? id;
      const teamLinks = Object.fromEntries(
        original.entryRows.map((row) => [
          remap(row.id),
          platform && row.teamSlug ? `/teams/${row.teamSlug}` : `/${row.eventSlug}/teams/${row.id}`,
        ]),
      );
      const entries = [
        ...new Map(
          original.entryRows.map((row) => [
            remap(row.id),
            {
              id: remap(row.id),
              name: platform ? (row.teamName ?? `${row.name} · ${row.eventName}`) : row.name,
            },
          ]),
        ).values(),
      ];
      for (const match of original.matches)
        if (remap(match.entryAId) === remap(match.entryBId))
          throw new Error("Platform team identity collision");
      const selected = platform
        ? original.selected.map((row) => ({
            ...row,
            facts: {
              ...row.facts,
              tournament: needs("overview", "teams", "maps")
                ? {
                    ...row.facts.tournament,
                    teamEntityKeys: {
                      teamA: remap(row.facts.tournament.teamEntityKeys.teamA),
                      teamB: remap(row.facts.tournament.teamEntityKeys.teamB),
                    },
                    playerWeapons: row.facts.tournament.playerWeapons.map((weapon) => ({
                      ...weapon,
                      teamEntityKey: remap(weapon.teamEntityKey),
                    })),
                  }
                : row.facts.tournament,
              performance:
                needs("overview", "players", "teams", "weapons") ||
                (scope.view === "maps" && scope.mapDetail)
                  ? remapTournamentPerformanceMapProjection(row.facts.performance, {
                      teamEntityKey: remap,
                      playerEntityKey: (id) => id,
                    })
                  : row.facts.performance,
            },
          }))
        : original.selected;
      const loaded = {
        ...original,
        selected,
        entries,
        matches: original.matches.map((match) => ({
          ...match,
          entryAId: remap(match.entryAId),
          entryBId: remap(match.entryBId),
        })),
        labels: {
          ...original.labels,
          teams: Object.fromEntries(entries.map((e) => [e.id, e.name])),
        },
      };
      const veto = await loadVetoData(tx, scope, entries, remap, original.vetoMatches);
      const unifiedPlayers = platform || scope.publicOnly;
      const leaderboard =
        needs("overview", "players") || (!unifiedPlayers && needs("teams"))
          ? await getStatsLeaderboard(
              { ...scope, matchIds: loaded.matchIds },
              loaded.selected.map((row) => row.importId),
              loaded.roster,
              tx,
              { groupByTeam: !unifiedPlayers },
            )
          : [];
      const teamScoreboard =
        unifiedPlayers && needs("overview", "teams")
          ? await getStatsLeaderboard(
              { ...scope, matchIds: loaded.matchIds },
              loaded.selected.map((row) => row.importId),
              loaded.roster,
              tx,
            )
          : leaderboard;
      return { original, platform, mapping, teamLinks, loaded, veto, leaderboard, teamScoreboard };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  // Release the snapshot connection before building the CPU-only public summaries.
  const { original, platform, mapping, teamLinks, loaded, veto, leaderboard, teamScoreboard } =
    snapshot;
  const remap = (id: string) => mapping.get(id) ?? id;
  const results = buildTournamentResults(
    resultMatchesForMapScope(loaded.matches, loaded.scopedMaps, scope.mapFilter),
    loaded.scopedMaps,
    loaded.entries,
  );
  const coverage = buildCoverage(loaded, results);
  const mapNames = [
    ...new Set([...loaded.maps.map((map) => map.mapName), ...veto.rows.map((row) => row.mapName)]),
  ].sort();
  const analytics = buildTournamentAnalytics(
    needs("overview", "teams", "maps") ? loaded.selected.map((row) => row.facts.tournament) : [],
    { labels: loaded.labels },
  );
  const performance = buildTournamentPerformanceAnalytics(
    needs("overview", "players", "teams", "weapons") || (scope.view === "maps" && scope.mapDetail)
      ? performanceFactsForScope(loaded, scope.weaponTeamId ?? scope.teamFilter)
      : [],
    { labels: loaded.labels },
  );
  const scopeLabel = [
    scope.seasonId ? (original.entryRows[0]?.eventName ?? "所选赛事") : "全部公开赛事",
    scope.stage,
    scope.format?.toUpperCase(),
    scope.mapFilter,
  ]
    .filter(Boolean)
    .join(" · ");
  const perMap = (needs("overview") ? loaded.selected : []).map((row) => ({
    mapKey: row.facts.performance.mapKey,
    performance: buildTournamentPerformanceAnalytics([row.facts.performance], {
      labels: loaded.labels,
    }),
  }));
  const insights = needs("overview")
    ? buildScopeInsights(analytics, performance, perMap, teamLinks, scopeLabel)
    : undefined;
  const { records, recordTies, recordCoverage, eventCounts, eventMaps } = (() => {
    if (!needs("records"))
      return {
        records: undefined,
        recordTies: undefined,
        recordCoverage: undefined,
        eventCounts: undefined,
        eventMaps: undefined,
      };
    const mapsById = new Map(original.scopedMaps.map((map) => [map.id, map]));
    const matchesById = new Map(original.matches.map((match) => [match.id, match]));
    const entriesById = new Map(original.entryRows.map((entry) => [entry.id, entry]));
    const occurrences: RecordOccurrence[] = original.selected.flatMap((row) => {
      const map = mapsById.get(row.facts.tournament.mapKey)!;
      const match = matchesById.get(map.matchId)!;
      return (row.facts.records?.candidates ?? []).map((candidate) => {
        const entry = entriesById.get(candidate.entryId)!;
        const isTeam = candidate.kind === "economy";
        const id = isTeam ? remap(candidate.entityId) : candidate.entityId;
        const opponent =
          entriesById.get(candidate.entryId === match.entryAId ? match.entryBId : match.entryAId)
            ?.name ?? "—";
        return {
          ...candidate,
          entityId: id,
          eventName: entry.eventName,
          eventSlug: entry.eventSlug,
          matchId: match.id,
          mapId: map.id,
          mapName: map.mapName,
          score: `${map.scoreA}-${map.scoreB}`,
          rounds: map.scoreA! + map.scoreB!,
          entityName: isTeam ? entry.name : (original.labels.players[id] ?? "选手"),
          entityHref: isTeam ? teamLinks[id]! : `/players/${id}`,
          opponent,
        };
      });
    });
    // Cumulative leaders aggregate every player-map count, not just map extrema.
    const totals = new Map<
      string,
      { fourKills: number; aces: number; sources: RecordOccurrence[] }
    >();
    for (const row of original.selected)
      for (const player of row.facts.records?.multiKills ?? []) {
        const total = totals.get(player.entityId) ?? { fourKills: 0, aces: 0, sources: [] };
        total.fourKills += player.fourKills;
        total.aces += player.aces;
        const map = mapsById.get(row.facts.tournament.mapKey)!;
        const entry = entriesById.get(player.entryId)!;
        const match = matchesById.get(map.matchId)!;
        for (const [kind, count] of [
          ["fourKillsTotal", player.fourKills],
          ["acesTotal", player.aces],
        ] as const)
          if (count) {
            total.sources.push({
              kind,
              entityId: player.entityId,
              entryId: player.entryId,
              numerator: count,
              denominator: 1,
              eventName: entry.eventName,
              eventSlug: entry.eventSlug,
              matchId: match.id,
              mapId: map.id,
              mapName: map.mapName,
              score: `${map.scoreA}-${map.scoreB}`,
              rounds: map.scoreA! + map.scoreB!,
              entityName: original.labels.players[player.entityId] ?? "选手",
              entityHref: `/players/${player.entityId}`,
              opponent:
                entriesById.get(player.entryId === match.entryAId ? match.entryBId : match.entryAId)
                  ?.name ?? "—",
            });
          }
        totals.set(player.entityId, total);
      }
    for (const total of totals.values())
      for (const source of total.sources)
        occurrences.push({
          ...source,
          numerator: source.kind === "fourKillsTotal" ? total.fourKills : total.aces,
        });
    const eventCounts = Object.fromEntries(
      Object.keys(RECORD_EVENT_NAMES).map((kind) => [
        kind,
        original.selected.reduce(
          (sum, row) => sum + (row.facts.records?.eventCounts?.[kind as RecordEventKind] ?? 0),
          0,
        ),
      ]),
    ) as Record<RecordEventKind, number>;
    const eventMaps = original.selected.filter((row) => row.facts.records?.eventCounts).length;
    const recordTies = collectRecordTies(occurrences);
    const records = buildRecords(recordTies);
    const recordCoverage = {
      maps: original.selected.filter((r) => r.facts.records).length,
      economyRounds: original.selected.reduce(
        (sum, r) => sum + (r.facts.records?.economyKnownRounds ?? 0),
        0,
      ),
    };
    return { records, recordTies, recordCoverage, eventCounts, eventMaps };
  })();
  return {
    leaderboard,
    teamRatings: buildTeamRatings(
      teamScoreboard.map((row) => ({ ...row, teamId: row.teamId ? remap(row.teamId) : null })),
    ),
    ...({ teamLinks } as { teamLinks?: Record<string, string> }),
    analytics,
    performance,
    ...({
      insights,
      records,
      recordTies,
      recordCoverage,
      recordEvents: undefined,
      eventCounts,
      eventMaps,
    } as {
      recordEvents?: RecordEventPage;
      eventCounts?: Record<RecordEventKind, number>;
      eventMaps?: number;
      insights?: Insight[];
      records?: RecordSummary[];
      recordTies?: RecordOccurrence[];
      recordCoverage?: { maps: number; economyRounds: number };
    }),
    results,
    selection: buildVetoSelection(veto.participants, veto.rows, mapNames, scope.mapFilter),
    veto: { teams: veto.teams, sample: veto.sample },
    coverage,
    options: { teams: platform ? [] : loaded.participantEntries, maps: mapNames },
  };
}

async function loadTournamentPlayerSnapshot(
  tx: TxDb,
  scope: PlatformStatsScope & { playerId: string },
  matchIds: readonly string[],
  options: {
    requireCurrentImports?: boolean;
    includeTestMatch?: boolean;
    effectiveRoster?: readonly EffectiveMatchRosterIdentity[];
  } = {},
) {
  const loaded = await loadStatsEvidenceSelection(
    tx,
    scope,
    {
      matchIds,
      includeTestMatch: options.includeTestMatch,
      effectiveRoster: options.effectiveRoster,
    },
    sql<PlayerDetailFacts>`jsonb_build_object(
    'tournament', jsonb_build_object(
      'mapKey', ${matchDemoStatProjections.facts}->'tournament'->'mapKey',
      'matchKey', ${matchDemoStatProjections.facts}->'tournament'->'matchKey',
      'mapName', ${matchDemoStatProjections.facts}->'tournament'->'mapName'
    )
  )`,
    true,
  );
  const { scoreboard, scoreboardMaps } = await getPlayerStatsScoreboards(
    scope,
    loaded.selected.map((row) => row.importId),
    loaded.roster,
    tx,
    {
      userId: scope.playerId,
      requireCurrentImports: options.requireCurrentImports,
      includeTestMatch: options.includeTestMatch,
    },
  );
  const record = await getPublicPlayerRecord(scope.playerId, {
    seasonId: scope.seasonId,
    matchIds,
    database: tx,
  });
  const [mvpRow] = matchIds.length
    ? await tx
        .select({ count: count() })
        .from(matches)
        .where(
          and(
            officialMatchCondition(),
            eq(matches.mvpWinnerUserId, scope.playerId),
            eq(matches.status, "finished"),
            scope.seasonId
              ? eq(matches.seasonId, scope.seasonId)
              : scope.seasonIds
                ? inArray(matches.seasonId, scope.seasonIds)
                : undefined,
            inArray(matches.id, [...matchIds]),
          ),
        )
    : [];
  return { loaded, scoreboard, scoreboardMaps, record, mvpRow, playerId: scope.playerId };
}

function computeTournamentPlayerDetail({
  loaded,
  scoreboard,
  scoreboardMaps,
  record,
  mvpRow,
  playerId,
}: Awaited<ReturnType<typeof loadTournamentPlayerSnapshot>>) {
  const performance = buildTournamentPerformanceAnalytics(
    loaded.selected.map((row) => row.facts.performance),
    { labels: loaded.labels },
  );
  const detail =
    indexStatsRows(performance.players, (row) => row.player.entityKey).get(playerId) ?? null;
  const maps = groupEvidenceByMap(loaded.selected).map(([mapName, rows]) => {
    const performance = buildTournamentPerformanceAnalytics(
      rows.map((row) => row.facts.performance),
      { labels: loaded.labels },
    );
    return {
      mapName,
      performance:
        indexStatsRows(performance.players, (row) => row.player.entityKey).get(playerId) ?? null,
    };
  });
  const results = buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries);
  const completedMaps = loaded.scopedMaps.filter(
    (map) => map.completedAt !== null && map.scoreA !== null && map.scoreB !== null,
  );
  const rounds = completedMaps.reduce((sum, map) => sum + map.scoreA! + map.scoreB!, 0);
  return {
    playerId: playerId,
    teamLinks: Object.fromEntries(
      loaded.entryRows.map((row) => [row.id, `/${row.eventSlug}/teams/${row.id}`]),
    ),
    teamNames: Object.fromEntries(loaded.entryRows.map((row) => [row.id, row.name])),
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

async function loadPerformanceEvidence(tx: TxDb, scope: PlatformStatsScope) {
  return await loadStatsEvidenceSelection(
    tx,
    scope,
    {},
    sql<{
      tournament: ProjectionTargets["tournament"];
      performance: typeof matchDemoStatProjections.$inferSelect.facts.performance;
    }>`jsonb_build_object(
      'tournament', jsonb_build_object(
        'mapKey', ${matchDemoStatProjections.facts}->'tournament'->'mapKey',
        'matchKey', ${matchDemoStatProjections.facts}->'tournament'->'matchKey'
      )
    )`,
    true,
  );
}

export async function getTournamentPerformancePlayers(
  scope: TournamentStatsScope,
  database: DB = db,
) {
  const loaded = await database.transaction(
    async (tx) => {
      // The benchmark consumes performance only; retain both target checks without
      // transferring tournament weapon facts or records for every public event.
      const loaded = await loadPerformanceEvidence(tx, scope);
      return loaded;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return buildTournamentPerformanceAnalytics(
    loaded.selected.map((row) => row.facts.performance),
    { labels: loaded.labels },
  ).players;
}

/** Bounded benchmark batches preserve one observation per player per public event. */
export async function getTournamentPerformancePopulations(
  eventIds: readonly string[],
  database: DB = db,
) {
  if (!eventIds.length) return [];
  const { events, loaded } = await database.transaction(
    async (tx) => {
      const events = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(and(inArray(seasons.id, [...eventIds]), ne(seasons.status, "draft")));
      const loaded = await loadPerformanceEvidence(tx, {
        seasonIds: events.map((event) => event.id),
      });
      return { events, loaded };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const eventByMap = new Map(loaded.currentRefs.map(({ map, match }) => [map.id, match.seasonId]));
  return events.map(
    (event) =>
      buildTournamentPerformanceAnalytics(
        loaded.selected
          .filter((row) => eventByMap.get(row.facts.performance.mapKey) === event.id)
          .map((row) => row.facts.performance),
        { labels: loaded.labels },
      ).players,
  );
}

export async function getTournamentPlayerDetail(
  scope: TournamentStatsScope & { playerId: string },
  database: DB = db,
) {
  const snapshot = await database.transaction(
    async (tx) => {
      const playerScope = await loadPlayerAppearanceScope(tx, scope.playerId, scope);
      return loadTournamentPlayerSnapshot(tx, scope, playerScope.matchIds, {
        effectiveRoster: playerScope.effectiveRoster,
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return computeTournamentPlayerDetail(snapshot);
}

/** Match Detail reuses the Stats Center metric owner for one canonical match scope. */
export async function getMatchPlayerDetail(matchId: string, playerId: string, mapName?: string) {
  const snapshot = await db.transaction(
    async (tx) => {
      const [match] = await tx
        .select({ seasonId: matches.seasonId })
        .from(matches)
        .where(eq(matches.id, matchId));
      if (!match || !match.seasonId) return null;
      return loadTournamentPlayerSnapshot(
        tx,
        { seasonId: match.seasonId, playerId, mapFilter: mapName },
        [matchId],
        { requireCurrentImports: true, includeTestMatch: true },
      );
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (!snapshot) return null;
  const detail = computeTournamentPlayerDetail(snapshot);
  return detail.performance ? detail : null;
}

/** Whole-match MVP metrics without scoreboard, career record or per-map detail queries. */
export async function getMatchMvpSummary(matchId: string, playerId: string, database: DB = db) {
  const loaded = await database.transaction(
    async (tx) => {
      const [match] = await tx
        .select({ seasonId: matches.seasonId })
        .from(matches)
        .where(eq(matches.id, matchId));
      if (!match?.seasonId) return null;
      return loadStatsEvidenceSelection(
        tx,
        { seasonId: match.seasonId },
        { matchIds: [matchId], includeTestMatch: true },
        sql<PlayerDetailFacts>`jsonb_build_object(
      'tournament', jsonb_build_object(
        'mapKey', ${matchDemoStatProjections.facts}->'tournament'->'mapKey',
        'matchKey', ${matchDemoStatProjections.facts}->'tournament'->'matchKey',
        'mapName', ${matchDemoStatProjections.facts}->'tournament'->'mapName'
      )
    )`,
        true,
      );
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (!loaded) return null;
  const player = buildTournamentPerformanceAnalytics(
    loaded.selected.map((row) => row.facts.performance),
    { labels: loaded.labels },
  ).players.find((row) => row.player.entityKey === playerId);
  if (!player) return null;
  const slice = player.slices.overall;
  return {
    rounds: slice.sample.rounds,
    kast: slice.kast,
    tradeKillsPerRound: slice.trade.tradeKillsPerRound,
    utilityDamagePerRound: slice.utility.utilityDamagePerRound,
    flashAssistsPerRound: slice.utility.flashAssistsPerRound,
  };
}

/** Small canonical option set, reused to bound public career cache keys. */
export async function getPlayerCareerFilterOptions(playerId: string, database: DB = db) {
  return database.transaction(
    async (tx) => (await loadPlayerAppearanceScope(tx, playerId)).events,
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function getPlayerCareerDetail(
  scope: { playerId: string; eventSlug?: string; mapFilter?: string },
  database: DB = db,
) {
  const snapshot = await database.transaction(
    async (tx) => {
      const playerScope = await loadPlayerAppearanceScope(tx, scope.playerId);
      const event = scope.eventSlug
        ? playerScope.events.find((candidate) => candidate.slug === scope.eventSlug)
        : undefined;
      const allMaps = new Set(playerScope.events.flatMap((candidate) => candidate.maps));
      const allowedMaps = event ? new Set(event.maps) : allMaps;
      const mapFilter =
        scope.mapFilter && allowedMaps.has(scope.mapFilter) ? scope.mapFilter : undefined;
      const matchIds = event
        ? [...(playerScope.matchIdsBySeason.get(event.id) ?? [])]
        : playerScope.matchIds;
      const detail = await loadTournamentPlayerSnapshot(
        tx,
        { playerId: scope.playerId, seasonId: event?.id, mapFilter },
        matchIds,
        { requireCurrentImports: true, effectiveRoster: playerScope.effectiveRoster },
      );
      return { detail, events: playerScope.events, selectedEvent: event ?? null, mapFilter };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return {
    ...computeTournamentPlayerDetail(snapshot.detail),
    events: snapshot.events,
    selectedEvent: snapshot.selectedEvent,
    mapFilter: snapshot.mapFilter,
  };
}

/** One read-only selection for the roster; each career retains its own effective appearances. */
export async function getPlayerCareerPerformances(playerIds: readonly string[], database: DB = db) {
  const { scopes, loaded } = await database.transaction(
    async (tx) => {
      const scopes = await loadPlayerAppearanceScopes(tx, [...new Set(playerIds)].sort());
      const matchIds = [...new Set([...scopes.values()].flatMap((scope) => scope.matchIds))];
      const loaded = await loadStatsEvidenceSelection(
        tx,
        {},
        { matchIds, effectiveRoster: scopes.values().next().value?.effectiveRoster },
        sql<PlayerDetailFacts>`jsonb_build_object(
      'tournament', jsonb_build_object(
        'mapKey', ${matchDemoStatProjections.facts}->'tournament'->'mapKey',
        'matchKey', ${matchDemoStatProjections.facts}->'tournament'->'matchKey',
        'mapName', ${matchDemoStatProjections.facts}->'tournament'->'mapName'
      )
    )`,
        true,
      );
      return { scopes, loaded };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return [...scopes].map(([playerId, scope]) => {
    const appearances = new Set(scope.matchIds);
    const maps = loaded.scopedMaps.filter(
      (map) =>
        appearances.has(map.matchId) &&
        map.completedAt !== null &&
        map.scoreA !== null &&
        map.scoreB !== null,
    );
    const mapIds = new Set(maps.map((map) => map.id));
    const performance =
      buildTournamentPerformanceAnalytics(
        loaded.selected
          .filter((row) => mapIds.has(row.facts.tournament.mapKey))
          .map((row) => row.facts.performance),
        { labels: loaded.labels },
      ).players.find((row) => row.player.entityKey === playerId) ?? null;
    return {
      playerId,
      maps: maps.length,
      rounds: maps.reduce((sum, map) => sum + map.scoreA! + map.scoreB!, 0),
      performance,
    };
  });
}

export function remapLinkedTeamFacts(
  selected: Awaited<ReturnType<typeof loadStatsDetailEvidence>>["selected"],
  linkedEntryIds: ReadonlySet<string>,
  teamId: string,
) {
  const remap = (entryId: string) => (linkedEntryIds.has(entryId) ? teamId : entryId);
  const projectPlayer = (playerEntityKey: string, entryId: string) => {
    const projectedTeamId = remap(entryId);
    return projectedTeamId === teamId
      ? playerEntityKey
      : `opponent:${projectedTeamId}:${playerEntityKey}`;
  };
  return selected.map((row) => ({
    ...row,
    facts: {
      tournament: {
        ...row.facts.tournament,
        teamEntityKeys: {
          teamA: remap(row.facts.tournament.teamEntityKeys.teamA),
          teamB: remap(row.facts.tournament.teamEntityKeys.teamB),
        },
        playerWeapons: row.facts.tournament.playerWeapons.map((fact) => ({
          ...fact,
          teamEntityKey: remap(fact.teamEntityKey),
        })),
      },
      performance: remapTournamentPerformanceMapProjection(row.facts.performance, {
        teamEntityKey: remap,
        playerEntityKey: projectPlayer,
      }),
    },
  }));
}

export function buildLongTeamPerformanceProjection(
  selected: Awaited<ReturnType<typeof loadStatsDetailEvidence>>["selected"],
  linkedEntryIds: ReadonlySet<string>,
  teamId: string,
  labels: StatsLabels = { teams: {}, players: {} },
) {
  const remapped = remapLinkedTeamFacts(selected, linkedEntryIds, teamId);
  const performance = buildTournamentPerformanceAnalytics(
    remapped.map((row) => row.facts.performance),
    { labels },
  );
  return {
    remapped,
    performance,
    teamPerformance: performance.teams.find((row) => row.team.entityKey === teamId) ?? null,
    detailedPlayers: performance.players.filter((row) => row.teamEntityKeys.includes(teamId)),
  };
}

export function buildCompetitionEntryPerformanceProjection(
  selected: Awaited<ReturnType<typeof loadStatsDetailEvidence>>["selected"],
  teamId: string,
  labels: StatsLabels = { teams: {}, players: {} },
) {
  return buildLongTeamPerformanceProjection(selected, new Set([teamId]), teamId, labels);
}

function officialTeamFacts(loaded: Awaited<ReturnType<typeof loadStatsContext>>) {
  return {
    matches: loaded.matches.map(
      ({ id, stage, round, entryAId, entryBId, scoreA, scoreB, status, completedAt }) => ({
        id,
        stage,
        round,
        entryAId,
        entryBId,
        scoreA,
        scoreB,
        status,
        completedAt,
      }),
    ),
    maps: loaded.scopedMaps.map(({ matchId, mapName, scoreA, scoreB, completedAt }) => ({
      matchId,
      mapName,
      scoreA,
      scoreB,
      completedAt,
    })),
    entries: buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries).teams,
  };
}

/**
 * Canonical all-time Team projection.
 *
 * Long Team identity is projected only at analytics time: immutable Evidence and
 * CompetitionEntry identities stay untouched. The match corpus is narrowed from
 * public linked entries first, then current-confirmed Evidence is selected once.
 */
export async function getLongTeamCareerDetail(teamId: string, database: DB = db) {
  const snapshot = await database.transaction(
    async (tx) => {
      const linkedEntries = await tx
        .select({
          id: competitionEntries.id,
          name: competitionEntries.name,
          seasonId: competitionEntries.competitionId,
          seasonSlug: seasons.slug,
          seasonName: seasons.name,
        })
        .from(competitionEntries)
        .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
        .where(
          and(
            eq(competitionEntries.teamId, teamId),
            ne(seasons.status, "draft"),
            publicCompetitionEntryCondition(),
          ),
        );
      const linkedEntryIds = new Set(linkedEntries.map((entry) => entry.id));
      if (!linkedEntryIds.size) return { linkedEntries, empty: true as const };

      const appearanceMatches = await tx
        .select({ id: matches.id })
        .from(matches)
        .where(
          and(
            officialMatchCondition(),
            eq(matches.status, "finished"),
            or(
              inArray(matches.entryAId, [...linkedEntryIds]),
              inArray(matches.entryBId, [...linkedEntryIds]),
            ),
          ),
        );
      const matchIds = appearanceMatches.map((match) => match.id);
      const loaded = await loadStatsDetailEvidence(tx, {}, { matchIds });
      const linkedRoster = loaded.roster.filter((row) => linkedEntryIds.has(row.entryId));
      const scoreboard = await getStatsLeaderboard(
        {},
        loaded.selected.map((row) => row.importId),
        linkedRoster,
        tx,
        { groupByTeam: false, requireCurrentImports: true, requireRosterMatch: true },
      );
      const vetoRows = matchIds.length
        ? await tx
            .select({
              matchId: matchVetoSteps.matchId,
              mapName: matchVetoSteps.mapName,
              action: matchVetoSteps.actionType,
              entryId: matchVetoSteps.entryId,
            })
            .from(matchVetoSteps)
            .where(inArray(matchVetoSteps.matchId, matchIds))
        : [];
      return { linkedEntries, linkedEntryIds, loaded, scoreboard, vetoRows, empty: false as const };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (snapshot.empty)
    return {
      teamId,
      linkedEntries: snapshot.linkedEntries,
      official: { matches: [], maps: [], entries: [] } as ReturnType<typeof officialTeamFacts>,
      results: { played: 0, wins: 0, losses: 0, maps: 0, mapWins: 0, mapLosses: 0 },
      analytics: null,
      economyMatrix: [],
      performance: null,
      scoreboard: [],
      teamRating: null,
      detailedPlayers: [],
      selection: [],
      vetoActionSamples: { pick: 0, ban: 0 },
      maps: [],
      coverage: { detailedMaps: 0, completedMaps: 0, maps: [] },
    };
  const { linkedEntries, linkedEntryIds, loaded, scoreboard, vetoRows } = snapshot;
  const labels: StatsLabels = {
    ...loaded.labels,
    teams: { ...loaded.labels.teams, [teamId]: linkedEntries[0]?.name ?? teamId },
  };
  const longPerformance = buildLongTeamPerformanceProjection(
    loaded.selected,
    linkedEntryIds,
    teamId,
    labels,
  );
  const { remapped, teamPerformance, detailedPlayers } = longPerformance;
  const analytics = buildTournamentAnalytics(
    remapped.map((row) => row.facts.tournament),
    { labels },
  );
  const teamAnalytics = analytics.teams.find((row) => row.team.entityKey === teamId) ?? null;

  const resultFacts = buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries);
  const ownResults = resultFacts.teams.filter((row) => linkedEntryIds.has(row.entryId));
  const mapRows = resultFacts.teamMaps.flatMap((map) =>
    map.teams
      .filter((row) => linkedEntryIds.has(row.entryId))
      .map((row) => ({ mapName: map.mapName, ...row })),
  );
  const mapResults = new Map<string, { played: number; wins: number; losses: number }>();
  for (const row of mapRows) {
    const current = mapResults.get(row.mapName) ?? { played: 0, wins: 0, losses: 0 };
    current.played += row.played;
    current.wins += row.wins;
    current.losses += row.losses;
    mapResults.set(row.mapName, current);
  }

  const teamRating = buildTeamRatings(scoreboard.map((row) => ({ ...row, teamId })))[0] ?? null;
  const remappedVeto = vetoRows.map((row) => ({
    ...row,
    entryId: row.entryId && linkedEntryIds.has(row.entryId) ? teamId : row.entryId,
  }));
  const selection = buildVetoSelection(
    [{ id: teamId, name: labels.teams[teamId] ?? teamId }],
    remappedVeto,
    [
      ...new Set([
        ...loaded.maps.map((map) => map.mapName),
        ...remappedVeto.map((row) => row.mapName),
      ]),
    ],
  );
  const analyticsByMap = aggregateEvidenceByMap(remapped, labels, { indexPlayers: true });
  const coverage = buildCoverage({ ...loaded, selected: remapped }, resultFacts);
  const coverageByMap = new Map(coverage.maps.map((row) => [row.mapName, row]));
  const maps = [
    ...new Set([
      ...mapResults.keys(),
      ...analyticsByMap.map((row) => row.mapName),
      ...selection.map((row) => row.mapName),
    ]),
  ]
    .sort()
    .map((mapName) => {
      const detail = analyticsByMap.find((row) => row.mapName === mapName);
      return {
        mapName,
        results: mapResults.get(mapName) ?? null,
        selection:
          selection
            .find((row) => row.mapName === mapName)
            ?.teams.find((row) => row.entryId === teamId) ?? null,
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
    official: officialTeamFacts(loaded),
    results: { played, wins, losses, maps: mapWins + mapLosses, mapWins, mapLosses },
    analytics: teamAnalytics,
    economyMatrix: analytics.economyMatrix,
    performance: teamPerformance,
    scoreboard,
    teamRating,
    detailedPlayers,
    selection,
    vetoActionSamples: vetoActionSamples(vetoRows),
    maps,
    coverage,
  };
}

async function loadTournamentTeamDetailSnapshot(
  scope: TournamentStatsScope & { teamId: string },
  tx: TxDb,
) {
  const loaded = await loadStatsDetailEvidence(tx, scope, { teamId: scope.teamId });
  const veto = await loadVetoData(tx, scope, loaded.entries);
  const scoreboard = await getStatsLeaderboard(
    { ...scope, teamFilter: scope.teamId },
    loaded.selected.map((row) => row.importId),
    loaded.roster,
    tx,
  );
  return { loaded, veto, scoreboard };
}

function projectTournamentTeamDetail(
  scope: TournamentStatsScope & { teamId: string },
  { loaded, veto, scoreboard }: Awaited<ReturnType<typeof loadTournamentTeamDetailSnapshot>>,
) {
  const results = buildTournamentResults(
    resultMatchesForMapScope(loaded.matches, loaded.scopedMaps, scope.mapFilter),
    loaded.scopedMaps,
    loaded.entries,
  );
  const analytics = buildTournamentAnalytics(
    loaded.selected.map((row) => row.facts.tournament),
    { labels: loaded.labels },
  );
  const performanceProjection = buildCompetitionEntryPerformanceProjection(
    loaded.selected,
    scope.teamId,
    loaded.labels,
  );
  const teamRating =
    buildTeamRatings(scoreboard).find((row) => row.entryId === scope.teamId) ?? null;
  const analyticsByMapName = new Map<string, ReturnType<typeof aggregateEvidenceByMap>[number]>();
  for (const row of aggregateEvidenceByMap(loaded.selected, loaded.labels))
    analyticsByMapName.set(row.mapName, row);
  const resultByMapName = new Map<
    string,
    { entryId: string; played: number; wins: number; losses: number }
  >();
  for (const map of results.teamMaps) {
    for (const team of map.teams) {
      if (team.entryId === scope.teamId)
        resultByMapName.set(map.mapName, {
          entryId: team.entryId,
          played: team.played,
          wins: team.wins,
          losses: team.losses,
        });
    }
  }
  const selection = buildVetoSelection(
    veto.participants,
    veto.rows,
    [
      ...new Set([
        ...loaded.maps.map((map) => map.mapName),
        ...veto.rows.map((row) => row.mapName),
      ]),
    ],
    scope.mapFilter,
  );
  const coverage = buildCoverage(loaded, results);
  const coverageByMapName = new Map(coverage.maps.map((row) => [row.mapName, row]));
  const selectionByMapName = new Map<string, { picks: number; bans: number }>();
  for (const map of selection) {
    for (const team of map.teams) {
      if (team.entryId === scope.teamId) selectionByMapName.set(map.mapName, team);
    }
  }
  const teamAnalytics = indexStatsRows(analytics.teams, (row) => row.team.entityKey);
  const mapNames = new Set([
    ...resultByMapName.keys(),
    ...analyticsByMapName.keys(),
    ...selectionByMapName.keys(),
  ]);
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
    vetoActionSamples: veto.actionSamples,
    official: officialTeamFacts(loaded),
    results: results.teams.find((row) => row.entryId === scope.teamId) ?? null,
    selection,
    analytics: teamAnalytics.get(scope.teamId) ?? null,
    economyMatrix: analytics.economyMatrix,
    performance: performanceProjection.teamPerformance,
    scoreboard,
    teamRating,
    detailedPlayers: performanceProjection.detailedPlayers,
    maps,
    coverage,
    entries: loaded.entries,
  };
}

/** Load one shared snapshot and preserve the separate team projections. */
export async function getTournamentTeamDetailsInTx(
  scope: Omit<TournamentStatsScope, "teamFilter">,
  teamIds: readonly string[],
  tx: TxDb,
) {
  const loaded = await loadStatsDetailEvidence(
    tx,
    { ...scope, teamFilter: undefined },
    { teamIds, reuseVetoMatches: true },
  );
  // Veto historically includes official matches with incomplete competition fields.
  const vetoMatches = (loaded.vetoMatches ?? []).filter((match) =>
    teamIds.some((id) => match.entryAId === id || match.entryBId === id),
  );
  const finishedIds = vetoMatches
    .filter((match) => match.status === "finished")
    .map((match) => match.id);
  const vetoRows = finishedIds.length
    ? await tx
        .select({
          matchId: matchVetoSteps.matchId,
          mapName: matchVetoSteps.mapName,
          action: matchVetoSteps.actionType,
          entryId: matchVetoSteps.entryId,
        })
        .from(matchVetoSteps)
        .where(inArray(matchVetoSteps.matchId, finishedIds))
    : [];
  const selections = teamIds.map((teamId) => {
    const matchIds = new Set(
      loaded.matches
        .filter((match) => match.entryAId === teamId || match.entryBId === teamId)
        .map((match) => match.id),
    );
    const selected = loaded.selected.filter((row) => matchIds.has(row.facts.tournament.matchKey));
    return { teamId, matchIds, selected, importIds: selected.map((row) => row.importId) };
  });
  const scoreboard = await getStatsLeaderboard(
    { ...scope, teamFilter: undefined, teamSelections: selections },
    loaded.selected.map((row) => row.importId),
    loaded.roster,
    tx,
  );
  const details = [];
  for (const { teamId, matchIds: ids, selected } of selections) {
    const teamMatches = loaded.matches.filter((match) => ids.has(match.id));
    const matchIds = teamMatches.map((match) => match.id);
    const playerIds = new Set(
      selected.flatMap((row) => loaded.playerIdsByImport.get(row.importId) ?? []),
    );
    const teamLoaded = {
      ...loaded,
      matches: teamMatches,
      matchIds,
      labels: {
        ...loaded.labels,
        players: Object.fromEntries(
          Object.entries(loaded.labels.players).filter(([id]) => playerIds.has(id)),
        ),
      },
      maps: loaded.maps.filter((map) => ids.has(map.matchId)),
      scopedMaps: loaded.scopedMaps.filter((map) => ids.has(map.matchId)),
      roster: loaded.roster.filter((row) => ids.has(row.matchId)),
      selected,
    };
    const matches = vetoMatches.filter(
      (match) => match.entryAId === teamId || match.entryBId === teamId,
    );
    const veto = await loadVetoData(
      tx,
      { ...scope, teamId },
      loaded.entries,
      undefined,
      matches,
      vetoRows,
    );
    details.push(
      projectTournamentTeamDetail(
        { ...scope, teamId },
        { loaded: teamLoaded, veto, scoreboard: scoreboard.filter((row) => row.teamId === teamId) },
      ),
    );
  }
  return details;
}

export async function getTournamentTeamDetailInTx(
  scope: TournamentStatsScope & { teamId: string },
  tx: TxDb,
) {
  return projectTournamentTeamDetail(scope, await loadTournamentTeamDetailSnapshot(scope, tx));
}

export async function getTournamentTeamDetail(
  scope: TournamentStatsScope & { teamId: string },
  database: DB = db,
) {
  const snapshot = await database.transaction((tx) => loadTournamentTeamDetailSnapshot(scope, tx), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
  return projectTournamentTeamDetail(scope, snapshot);
}

export async function getTournamentMapDetail(
  scope: Omit<TournamentStatsScope, "mapFilter" | "teamFilter"> & { map: string },
  database: DB = db,
) {
  const snapshot = await database.transaction(
    async (tx) => {
      const loaded = await loadStatsDetailEvidence(tx, scope, { mapName: scope.map });
      const vetoRows = await loadScopedVetoRows(tx, scope, scope.map);
      return { loaded, vetoRows };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const { loaded, vetoRows } = snapshot;
  const results = buildTournamentResults(loaded.matches, loaded.scopedMaps, loaded.entries);
  const analytics = buildTournamentAnalytics(
    loaded.selected.map((row) => row.facts.tournament),
    { labels: loaded.labels },
  );
  const performance = buildTournamentPerformanceAnalytics(
    loaded.selected.map((row) => row.facts.performance),
    { labels: loaded.labels },
  );
  return {
    map: scope.map,
    results,
    selection: buildVetoSelection(
      [],
      vetoRows.map(({ mapName, action, entryId }) => ({ mapName, action, entryId })),
      [scope.map],
      scope.map,
    ),
    coverage: buildCoverage(loaded, results),
    analytics,
    performance,
    entries: loaded.entries,
  };
}

export type TournamentStats = Awaited<ReturnType<typeof getTournamentStats>>;
export type TournamentPlayerDetail = Awaited<ReturnType<typeof getTournamentPlayerDetail>>;
export type TournamentTeamDetail = Awaited<ReturnType<typeof getTournamentTeamDetail>>;
export type LongTeamCareerDetail = Awaited<ReturnType<typeof getLongTeamCareerDetail>>;
export type TournamentMapDetail = Awaited<ReturnType<typeof getTournamentMapDetail>>;
