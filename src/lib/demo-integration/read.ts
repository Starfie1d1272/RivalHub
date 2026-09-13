import "server-only";

import { and, asc, desc, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db/client";
import {
  competitionEntries,
  eventRosterMembers,
  eventRosters,
  dakPairings,
  matchDemoImports,
  matchMaps,
  matchRosterPlayers,
  matchRosters,
  matchVetoSteps,
  matches,
  seasons,
  users,
} from "@/db/schema";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/lib/seasons/compatibility";
import { pairingCanReadSeason } from "./pairing";
import { buildEvidenceRevision, sha256Json, type EvidenceRevisionRosterMember } from "./revision";
import type {
  IntegrationIssue,
  RivalHubEventsResponse,
  RivalHubRemoteMap,
  RivalHubRemotePlayer,
  RivalHubRemoteSeries,
  RivalHubRemoteStage,
  RivalHubRemoteTeam,
} from "./contracts";

type PairingScope = Pick<typeof dakPairings.$inferSelect, "seasonIds">;

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function displayName(row: { displayName: string | null; steamName: string | null; perfectName: string | null; steam64: string | null }): string {
  return row.displayName?.trim() || row.steamName?.trim() || row.perfectName?.trim() || row.steam64?.trim() || "未知选手";
}

function validSteam64(value: string | null): value is string {
  return value != null && /^\d{17}$/.test(value);
}

function projectIssues(value: unknown): IntegrationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const issue = row as { code?: unknown; path?: unknown; message?: unknown };
    if (typeof issue.code !== "string" || typeof issue.message !== "string") return [];
    return [{
      code: issue.code,
      ...(typeof issue.path === "string" ? { path: issue.path } : {}),
      message: issue.message,
    }];
  });
}

function stageType(type: string): RivalHubRemoteStage["type"] {
  return type === "round_robin" || type === "swiss" || type === "single_elim" || type === "double_elim" || type === "gsl_group"
    ? type
    : "round_robin";
}

function projectStage(stage: ReturnType<typeof normalizeStagePlan>[number]): RivalHubRemoteStage {
  return {
    key: stage.key,
    name: stage.name,
    type: stageType(stage.type),
    teamCount: stage.teamCount,
    advanceCount: stage.advanceTiers.reduce((sum, tier) => sum + tier.count, 0),
    matchFormat: stage.matchFormat ?? null,
    finalFormat: stage.finalFormat ?? null,
  };
}

function projectPlayer(row: {
  entryId: string;
  userId: string;
  eventRosterMemberId: string;
  steam64: string | null;
  displayName: string | null;
  steamName: string | null;
  perfectName: string | null;
  isStarter: boolean;
}): RivalHubRemotePlayer | null {
  if (!validSteam64(row.steam64)) return null;
  return {
    entryId: row.entryId,
    userId: row.userId,
    eventRosterMemberId: row.eventRosterMemberId,
    steamId64: row.steam64,
    name: displayName(row),
    isStarter: row.isStarter,
  };
}

export function projectDemoStatus(
  match: { status: "scheduled" | "in_progress" | "finished" | "cancelled" },
  map: { completedAt: Date | null; scoreA: number | null; scoreB: number | null },
  latest: typeof matchDemoImports.$inferSelect | undefined,
  currentEvidenceRevision?: string,
): RivalHubRemoteMap["demoStatus"] {
  const mapFinished = map.completedAt != null && map.scoreA != null && map.scoreB != null;
  if (mapFinished) {
    if (!latest) return "finished_pending_demo";
    if (latest.status === "confirmed") {
      return currentEvidenceRevision != null && latest.evidenceRevision !== currentEvidenceRevision
        ? "needs_attention"
        : "synced";
    }
    if (latest.status === "pending") return "demo_processing";
    if (["needs_attention", "stale", "rejected", "superseded"].includes(latest.status)) return "needs_attention";
    return "finished_pending_demo";
  }
  const mapStarted = map.completedAt != null || map.scoreA != null || map.scoreB != null;
  return match.status === "in_progress" && mapStarted ? "live" : "not_started";
}

const staleEvidenceIssue: IntegrationIssue = {
  code: "STALE_EVIDENCE",
  path: "target.evidenceRevision",
  message: "赛事阵容/比分上下文已变化，请重新生成并同步 Demo Evidence。",
};

export function projectDemoIssues(
  latest: typeof matchDemoImports.$inferSelect | undefined,
  latestConfirmed: typeof matchDemoImports.$inferSelect | undefined,
  currentEvidenceRevision: string,
): IntegrationIssue[] {
  const issues = projectIssues(latest?.issues);
  if (
    latestConfirmed != null
    && latestConfirmed.evidenceRevision !== currentEvidenceRevision
    && !issues.some((row) => row.code === staleEvidenceIssue.code)
  ) issues.push(staleEvidenceIssue);
  return issues;
}

function projectVeto(
  match: { id: string; format: "bo1" | "bo3" | "bo5"; entryAId: string; entryBId: string },
  teamAName: string,
  teamBName: string,
  mapPool: string[],
  rows: Array<typeof matchVetoSteps.$inferSelect>,
) {
  if (rows.length === 0 || rows.some((row) => !["ban", "pick", "decider"].includes(row.actionType))) return null;
  const teamKey = (entryId: string | null): "teamA" | "teamB" | null => entryId === match.entryAId ? "teamA" : entryId === match.entryBId ? "teamB" : null;
  const steps = [...rows].sort((a, b) => a.stepOrder - b.stepOrder).map((row) => ({
    stepOrder: row.stepOrder,
    actionType: row.actionType as "ban" | "pick" | "decider",
    mapName: row.mapName,
    teamKey: teamKey(row.entryId),
    side: row.side,
  }));
  return {
    version: "cs2-demo-analysis-kit/series-veto-0.1" as const,
    seriesId: match.id,
    format: match.format,
    teamAName,
    teamBName,
    mapPool,
    maps: {
      picked: steps.filter((step) => step.actionType === "pick" && step.teamKey).map((step) => ({ mapName: step.mapName, teamKey: step.teamKey! })),
      banned: steps.filter((step) => step.actionType === "ban" && step.teamKey).map((step) => ({ mapName: step.mapName, teamKey: step.teamKey! })),
      decider: steps.find((step) => step.actionType === "decider")?.mapName ?? null,
    },
    sideChoices: steps.filter((step) => step.side != null).map((step) => ({
      mapName: step.mapName,
      teamKey: step.actionType === "pick" ? step.teamKey === "teamA" ? "teamB" : step.teamKey === "teamB" ? "teamA" : null : step.teamKey,
      side: step.side!,
    })),
    steps,
  };
}

export async function readRivalHubEvents(pairing: PairingScope): Promise<RivalHubEventsResponse> {
  const seasonRows = pairing.seasonIds.includes("*")
    ? await db.select().from(seasons).orderBy(asc(seasons.slug))
    : pairing.seasonIds.length > 0
      ? await db.select().from(seasons).where(inArray(seasons.id, pairing.seasonIds)).orderBy(asc(seasons.slug))
      : [];
  if (seasonRows.length === 0) return { contractVersion: "rivalhub-dak-events/1", generatedAt: new Date().toISOString(), events: [] };
  const seasonIds = seasonRows.map((season) => season.id);
  const entries = await db.select().from(competitionEntries).where(inArray(competitionEntries.competitionId, seasonIds));
  const entryIds = entries.map((entry) => entry.id);
  if (entryIds.length === 0) {
    return {
      contractVersion: "rivalhub-dak-events/1",
      generatedAt: new Date().toISOString(),
      events: seasonRows.map((season) => ({ id: season.id, seasonId: season.id, slug: season.slug, name: season.name, kind: season.kind, revision: sha256Json({ seasonId: season.id, updatedAt: season.updatedAt.toISOString() }), stages: normalizeStagePlan(season.stagePlan).map(projectStage), teams: [], series: [] })),
    };
  }

  const [rosterRows, matchRows] = await Promise.all([
    db.select({
      entryId: competitionEntries.id,
      eventRosterId: eventRosters.id,
      eventRosterStatus: eventRosters.status,
      eventRosterMemberId: eventRosterMembers.id,
      userId: users.id,
      steam64: users.steam64,
      displayName: users.displayName,
      steamName: users.steamName,
      perfectName: users.perfectName,
      isStarter: eventRosterMembers.isPrimaryStarter,
    }).from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
      .innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
      .innerJoin(users, eq(users.id, eventRosterMembers.userId))
      .where(and(inArray(competitionEntries.competitionId, seasonIds), inArray(eventRosters.status, ["confirmed", "frozen"]))),
    db.select().from(matches).where(and(inArray(matches.seasonId, seasonIds), or(inArray(matches.entryAId, entryIds), inArray(matches.entryBId, entryIds)))),
  ]);
  const matchIds = matchRows.map((match) => match.id);
  const mapRows = matchIds.length > 0
    ? await db.select().from(matchMaps).where(inArray(matchMaps.matchId, matchIds)).orderBy(asc(matchMaps.mapOrder))
    : [];
  const vetoRows = matchIds.length > 0
    ? await db.select().from(matchVetoSteps).where(inArray(matchVetoSteps.matchId, matchIds)).orderBy(asc(matchVetoSteps.stepOrder))
    : [];
  const matchRosterRows = matchIds.length > 0
    ? await db.select({
        matchId: matchRosters.matchId,
        entryId: matchRosters.entryId,
        rosterId: matchRosters.id,
        eventRosterMemberId: eventRosterMembers.id,
        userId: users.id,
        steam64: users.steam64,
        displayName: users.displayName,
        steamName: users.steamName,
        perfectName: users.perfectName,
        isStarter: matchRosterPlayers.isStarter,
      }).from(matchRosterPlayers)
        .innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
        .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
        .innerJoin(users, eq(users.id, eventRosterMembers.userId))
        .where(and(inArray(matchRosters.matchId, matchIds), eq(matchRosters.status, "confirmed"), eq(matchRosterPlayers.isStarter, true)))
    : [];
  const importRows = mapRows.length > 0
    ? await db.select().from(matchDemoImports).where(inArray(matchDemoImports.matchMapId, mapRows.map((map) => map.id))).orderBy(desc(matchDemoImports.createdAt))
    : [];

  const latestImportByMap = new Map<string, typeof matchDemoImports.$inferSelect>();
  for (const row of importRows) if (!latestImportByMap.has(row.matchMapId)) latestImportByMap.set(row.matchMapId, row);
  const latestConfirmedImportByMap = new Map<string, typeof matchDemoImports.$inferSelect>();
  for (const row of importRows) {
    if (row.status === "confirmed" && !latestConfirmedImportByMap.has(row.matchMapId)) latestConfirmedImportByMap.set(row.matchMapId, row);
  }
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const rosterByEntry = new Map<string, typeof rosterRows>();
  for (const row of rosterRows) {
    const list = rosterByEntry.get(row.entryId) ?? [];
    list.push(row);
    rosterByEntry.set(row.entryId, list);
  }
  const matchRosterByMatch = new Map<string, typeof matchRosterRows>();
  for (const row of matchRosterRows) {
    const list = matchRosterByMatch.get(row.matchId) ?? [];
    list.push(row);
    matchRosterByMatch.set(row.matchId, list);
  }
  const mapsByMatch = new Map<string, typeof mapRows>();
  for (const row of mapRows) {
    const list = mapsByMatch.get(row.matchId) ?? [];
    list.push(row);
    mapsByMatch.set(row.matchId, list);
  }
  const vetoByMatch = new Map<string, typeof vetoRows>();
  for (const row of vetoRows) {
    const list = vetoByMatch.get(row.matchId) ?? [];
    list.push(row);
    vetoByMatch.set(row.matchId, list);
  }

  return {
    contractVersion: "rivalhub-dak-events/1",
    generatedAt: new Date().toISOString(),
    events: seasonRows.filter((season) => pairingCanReadSeason(pairing, season.id)).map((season) => {
      const seasonEntries = entries.filter((entry) => entry.competitionId === season.id);
      const seasonEntryIds = new Set(seasonEntries.map((entry) => entry.id));
      const seasonMatches = matchRows.filter((match) => match.seasonId === season.id && seasonEntryIds.has(match.entryAId) && seasonEntryIds.has(match.entryBId));
      const teams: RivalHubRemoteTeam[] = seasonEntries.map((entry) => ({
        key: entry.id,
        name: entry.name,
        players: (rosterByEntry.get(entry.id) ?? []).map((row) => projectPlayer({
          entryId: row.entryId,
          userId: row.userId,
          eventRosterMemberId: row.eventRosterMemberId,
          steam64: row.steam64,
          displayName: row.displayName,
          steamName: row.steamName,
          perfectName: row.perfectName,
          isStarter: row.isStarter,
        })).filter((row): row is RivalHubRemotePlayer => row != null),
      }));
      const stages = normalizeStagePlan(season.stagePlan).map(projectStage);
      const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
      const series: RivalHubRemoteSeries[] = seasonMatches.map((match) => {
        const entryA = entryById.get(match.entryAId)!;
        const entryB = entryById.get(match.entryBId)!;
        const matchRoster = (matchRosterByMatch.get(match.id) ?? []).map((row) => projectPlayer(row)).filter((row): row is RivalHubRemotePlayer => row != null);
        const revisionRoster: EvidenceRevisionRosterMember[] = (matchRosterByMatch.get(match.id) ?? []).map((row) => ({ entryId: row.entryId, eventRosterMemberId: row.eventRosterMemberId, userId: row.userId, steam64: row.steam64, isStarter: row.isStarter }));
        const mapRecords: RivalHubRemoteMap[] = (mapsByMatch.get(match.id) ?? []).map((map) => {
          const evidenceRevision = buildEvidenceRevision({
            seasonId: season.id,
            stageKey: match.stage,
            stageRunId: match.majorStageRunId,
            matchId: match.id,
            matchMapId: map.id,
            mapOrder: map.mapOrder,
            mapName: map.mapName,
            mapScoreA: map.scoreA,
            mapScoreB: map.scoreB,
            mapCompletedAt: iso(map.completedAt),
            matchStatus: match.status,
            entryAId: match.entryAId,
            entryBId: match.entryBId,
            roster: revisionRoster,
          });
          const latest = latestImportByMap.get(map.id);
          const latestConfirmed = latestConfirmedImportByMap.get(map.id);
          const confirmedIsStale = latestConfirmed != null && latestConfirmed.evidenceRevision !== evidenceRevision;
          const demoIssues = projectDemoIssues(latest, latestConfirmed, evidenceRevision);
          return {
            id: map.id,
            order: map.mapOrder,
            mapName: map.mapName,
            scoreA: map.scoreA,
            scoreB: map.scoreB,
            completedAt: iso(map.completedAt),
            evidenceRevision,
            target: {
              seasonId: season.id,
              stageKey: match.stage,
              stageRunId: match.majorStageRunId,
              matchId: match.id,
              matchMapId: map.id,
              mapOrder: map.mapOrder,
              entryAId: match.entryAId,
              entryBId: match.entryBId,
              expectedMapName: map.mapName,
              evidenceRevision,
            },
            lineup: matchRoster,
            demoStatus: confirmedIsStale ? "needs_attention" : projectDemoStatus(match, map, latest, evidenceRevision),
            demoIssues,
            importId: latest?.status === "confirmed" ? latest.id : null,
            demoSha256: latest?.status === "confirmed" ? latest.demoSha256 : null,
          };
        });
        return {
          id: match.id,
          key: `${match.stage}:${match.id}`,
          stageKey: match.stage,
          round: match.round,
          entryRound: match.entryRound,
          bracketNodeId: match.bracketNodeId,
          status: match.status,
          format: match.format,
          entryAId: match.entryAId,
          entryBId: match.entryBId,
          teamAKey: entryA.id,
          teamBKey: entryB.id,
          teamAName: entryA.name,
          teamBName: entryB.name,
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          scheduledAt: iso(match.scheduledAt),
          completedAt: iso(match.completedAt),
          teamARecordBefore: null,
          teamBRecordBefore: null,
          maps: mapRecords,
          veto: projectVeto(match, entryA.name, entryB.name, mapPool, vetoByMatch.get(match.id) ?? []),
        };
      });
      return {
        id: season.id,
        seasonId: season.id,
        slug: season.slug,
        name: season.name,
        kind: season.kind,
        revision: sha256Json({ seasonId: season.id, updatedAt: season.updatedAt.toISOString(), matches: series.map((item) => ({ id: item.id, maps: item.maps.map((map) => ({ id: map.id, evidenceRevision: map.evidenceRevision })) })) }),
        stages,
        teams,
        series,
      };
    }),
  };
}
