import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import { competitionEntries, matchCommentators, matchDemoImports, matchMaps, matchPlayerStats, matches, postMatchReports } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { officialMatchCondition } from "@/lib/matches/scope";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
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

/** Authorized caller supplies the season. Child reads use only IDs from this scoped official query. */
export async function readAdminPostMatchTasks(database: DB | TxDb, seasonId: string, userId: string): Promise<AdminPostMatchTaskRow[]> {
  const matchRows = await database.select().from(matches)
    .where(and(eq(matches.seasonId, seasonId), officialMatchCondition(), eq(matches.status, "finished")))
    .orderBy(desc(matches.completedAt), asc(matches.id));
  if (matchRows.length === 0) return [];
  const ids = matchRows.map(match => match.id);
  const [maps, roster, imports, scoreboards, commentators, reports, entries] = await Promise.all([
    database.select().from(matchMaps).where(inArray(matchMaps.matchId, ids)).orderBy(asc(matchMaps.mapOrder)),
    loadEffectiveMatchRoster(database, ids, true),
    database.select(demoImportMetadataSelection).from(matchDemoImports).where(and(eq(matchDemoImports.seasonId, seasonId), inArray(matchDemoImports.matchId, ids))).orderBy(desc(matchDemoImports.createdAt)),
    database.select().from(matchPlayerStats).where(inArray(matchPlayerStats.matchId, ids)),
    database.select({ matchId: matchCommentators.matchId, userId: matchCommentators.userId }).from(matchCommentators).where(inArray(matchCommentators.matchId, ids)),
    database.select({ matchId: postMatchReports.matchId }).from(postMatchReports).where(inArray(postMatchReports.matchId, ids)),
    database.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, seasonId), inArray(competitionEntries.id, [...new Set(matchRows.flatMap(match => [match.entryAId, match.entryBId]).filter((id): id is string => id !== null))]))),
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
      commentatorCount: people.length, submitted: submitted.has(match.id), hasVideo: Boolean(match.videoUrl) });
    if (tasks.length === 0 || !match.entryAId || !match.entryBId) return [];
    return [{ id: match.id, stage: match.stage ?? "", entryAId: match.entryAId, entryBId: match.entryBId,
      teamAName: names.get(match.entryAId) ?? "未知队伍", teamBName: names.get(match.entryBId) ?? "未知队伍",
      isMine: people.some(person => person.userId === userId), tasks }];
  }).sort((a, b) => Number(b.isMine) - Number(a.isMine));
}
