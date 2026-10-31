import { hasMatchRecordingCondition } from "@/lib/postmatch/recording-query";
import "server-only";
import { readReopenedPostMatchIds } from "@/lib/postmatch/read";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import { competitionEntries, matchCommentators, matchDemoImports, matchMaps, matchPlayerStats, matches, postMatchReports } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { officialMatchCondition } from "@/lib/matches/scope";
import { loadEffectiveMatchRosterIdentities } from "@/lib/match-rosters/effective";
import { demoImportMetadataSelection } from "@/lib/demo-integration/metadata";
import { projectOperatorMaps } from "./operator-maps";
import { projectOperatorPostMatchTasks } from "./operator-workflow";

export interface AdminPostMatchTaskRow {
  id: string;
  stage: string;
  entryAId: string;
  entryBId: string;
  teamAName: string;
  teamBName: string;
  isMine: boolean;
  tasks: { label: string; anchor: string }[];
}

export async function loadAdminPostMatchTasks(seasonId: string): Promise<AdminPostMatchTaskRow[]> {
  const admin = await requireSeasonAdmin(seasonId);
  return readAdminPostMatchTasks(db, seasonId, admin.userId);
}

export async function loadAdminPostMatchTaskPage(seasonId: string, scope: { stage?: string; team?: string; page?: string }) {
  const admin = await requireSeasonAdmin(seasonId);
  // Derive all task states in scope before pagination. A raw finished-match
  // LIMIT would hide late missing/stale Demo or reopened production work.
  const tasks = await readAdminPostMatchTasks(db, seasonId, admin.userId, scope);
  const total = tasks.length, totalPages = Math.ceil(total / 25);
  const requested = Number(scope.page);
  const page = totalPages ? Math.min(Number.isSafeInteger(requested) && requested > 0 ? requested : 1, totalPages) : 1;
  return { rows: tasks.slice((page - 1) * 25, page * 25), total, page, pageSize: 25, totalPages,
    mineCount: tasks.filter(row => row.isMine).length };
}

/** Authorized caller supplies the season. Child reads use only IDs from this scoped official query. */
export async function readAdminPostMatchTasks(database: DB | TxDb, seasonId: string, userId: string, scope: { stage?: string; team?: string; matchIds?: readonly string[] } = {}): Promise<AdminPostMatchTaskRow[]> {
  if (scope.matchIds?.length === 0) return [];
  const matchRows = await database.select({
    id: matches.id, seasonId: matches.seasonId, stage: matches.stage,
    majorStageRunId: matches.majorStageRunId, status: matches.status,
    entryAId: matches.entryAId, entryBId: matches.entryBId, isForfeit: matches.isForfeit,
    hasVideo: hasMatchRecordingCondition().mapWith(Boolean),
  }).from(matches)
    .where(and(eq(matches.seasonId, seasonId), officialMatchCondition(), eq(matches.status, "finished"),
      scope.matchIds ? inArray(matches.id, [...scope.matchIds]) : undefined,
      scope.stage && scope.stage !== "all" ? eq(matches.stage, scope.stage) : undefined,
      scope.team && scope.team !== "all" ? or(sql`${matches.entryAId}::text = ${scope.team}`, sql`${matches.entryBId}::text = ${scope.team}`) : undefined))
    .orderBy(desc(matches.completedAt), asc(matches.id));
  if (matchRows.length === 0) return [];
  const ids = matchRows.map(match => match.id);
  const [maps, roster, imports, scoreboards, commentators, reports, entries, reopenedIds] = await Promise.all([
    database.select({ id: matchMaps.id, matchId: matchMaps.matchId, mapOrder: matchMaps.mapOrder,
      mapName: matchMaps.mapName, teamAStartSide: matchMaps.teamAStartSide,
      scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB, completedAt: matchMaps.completedAt,
    }).from(matchMaps).where(inArray(matchMaps.matchId, ids)).orderBy(asc(matchMaps.mapOrder)),
    loadEffectiveMatchRosterIdentities(database, ids),
    database.select(demoImportMetadataSelection).from(matchDemoImports).where(and(eq(matchDemoImports.seasonId, seasonId), inArray(matchDemoImports.matchId, ids))).orderBy(desc(matchDemoImports.createdAt)),
    database.select({ matchId: matchPlayerStats.matchId, mapId: matchPlayerStats.mapId,
      userId: matchPlayerStats.userId, perfectName: matchPlayerStats.perfectName,
      kills: matchPlayerStats.kills, deaths: matchPlayerStats.deaths, assists: matchPlayerStats.assists,
      hsPercent: matchPlayerStats.hsPercent, firstKills: matchPlayerStats.firstKills,
      multiKills: matchPlayerStats.multiKills, clutches: matchPlayerStats.clutches,
      adr: matchPlayerStats.adr, ratingPro: matchPlayerStats.ratingPro, rws: matchPlayerStats.rws, we: matchPlayerStats.we,
    }).from(matchPlayerStats).where(inArray(matchPlayerStats.matchId, ids)),
    database.select({ matchId: matchCommentators.matchId, userId: matchCommentators.userId }).from(matchCommentators).where(inArray(matchCommentators.matchId, ids)),
    database.select({ matchId: postMatchReports.matchId }).from(postMatchReports).where(inArray(postMatchReports.matchId, ids)),
    database.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, seasonId), inArray(competitionEntries.id, [...new Set(matchRows.flatMap(match => [match.entryAId, match.entryBId]).filter((id): id is string => id !== null))]))),
    readReopenedPostMatchIds(database, ids),
  ]);
  const groupByMatch = <T extends { matchId: string }>(rows: readonly T[]) => {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      const group = grouped.get(row.matchId) ?? [];
      group.push(row);
      grouped.set(row.matchId, group);
    }
    return grouped;
  };
  const mapsByMatch = groupByMatch(maps);
  const rosterByMatch = groupByMatch(roster);
  const importsByMatch = groupByMatch(imports);
  const scoresByMatch = groupByMatch(scoreboards);
  const peopleByMatch = groupByMatch(commentators);
  const names = new Map(entries.map(entry => [entry.id, entry.name]));
  const submitted = new Set(reports.map(report => report.matchId));
  return matchRows.flatMap(match => {
    const people = peopleByMatch.get(match.id) ?? [];
    const operatorMaps = projectOperatorMaps({ match, maps: mapsByMatch.get(match.id) ?? [],
      roster: rosterByMatch.get(match.id) ?? [], imports: importsByMatch.get(match.id) ?? [],
      scoreboards: scoresByMatch.get(match.id) ?? [] });
    const tasks = projectOperatorPostMatchTasks({ status: match.status, isForfeit: match.isForfeit, maps: operatorMaps,
      commentatorCount: people.length, submitted: submitted.has(match.id), reopened: reopenedIds.has(match.id), hasVideo: match.hasVideo });
    if (tasks.length === 0 || !match.entryAId || !match.entryBId) return [];
    return [{ id: match.id, stage: match.stage ?? "", entryAId: match.entryAId, entryBId: match.entryBId,
      teamAName: names.get(match.entryAId) ?? "未知队伍", teamBName: names.get(match.entryBId) ?? "未知队伍",
      isMine: people.some(person => person.userId === userId), tasks }];
  }).sort((a, b) => Number(b.isMine) - Number(a.isMine));
}
