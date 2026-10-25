import "server-only";

import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, matchDemoImports, matchMaps, matchRosterPlayers, matchRosters, matches } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import { demoImportMetadataSelection } from "@/lib/demo-integration/metadata";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { loadAdminDemoReview } from "./demo-review";
import { projectAdminDemoQuality } from "./demo-quality";
import { enrichAdminDemoReviewPersonas } from "./demo-personas";

/** Read-only presentation snapshot. Every mutation retains its locked canonical recheck. */
export async function readAdminDemoReview(input: { seasonId: string; matchId: string; mapId: string; importId: string }) {
  await requireSeasonAdmin(input.seasonId);
  const result = await db.transaction(async tx => {
    const match = await tx.query.matches.findFirst({ where: and(eq(matches.id, input.matchId), eq(matches.seasonId, input.seasonId)) });
    const map = await tx.query.matchMaps.findFirst({ where: and(eq(matchMaps.id, input.mapId), eq(matchMaps.matchId, input.matchId)) });
    if (!match || !map) throw new AppError(ErrorCode.NOT_FOUND, "未找到可访问的比赛地图。");
    assertCompetitionMatch(match);
    const metadata = await tx.select(demoImportMetadataSelection).from(matchDemoImports)
      .where(and(eq(matchDemoImports.seasonId, input.seasonId), eq(matchDemoImports.matchId, input.matchId), eq(matchDemoImports.matchMapId, input.mapId)))
      .orderBy(desc(matchDemoImports.createdAt));
    const current = selectCurrentDemoImport(metadata);
    if (current?.id !== input.importId || current.status !== "needs_attention") throw new AppError(ErrorCode.VALIDATION_FAILED, "本图 Demo 状态已变化，请刷新工作台。");
    const [artifact] = await tx.select().from(matchDemoImports).where(eq(matchDemoImports.id, current.id));
    if (!artifact) throw new AppError(ErrorCode.NOT_FOUND, "这份 Demo 数据已不可用。");
    const entryIds = [match.entryAId, match.entryBId];
    const entries = await tx.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries)
      .where(and(eq(competitionEntries.competitionId, input.seasonId), inArray(competitionEntries.id, entryIds)));
    const roster = await loadEffectiveMatchRoster(tx, [match.id]);
    const members = await tx.select({ entryId: eventRosters.entryId, userId: eventRosterMembers.userId }).from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .where(and(inArray(eventRosters.entryId, entryIds), inArray(eventRosters.status, ["confirmed", "frozen"]),
        or(eq(eventRosterMembers.isCurrent, true), inArray(eventRosterMembers.id, tx.select({ id: matchRosterPlayers.eventRosterMemberId })
          .from(matchRosterPlayers).innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId)).where(eq(matchRosters.matchId, match.id))))));
    const memberIds = new Map<string, Set<string>>();
    for (const member of members) { const ids = memberIds.get(member.entryId) ?? new Set<string>(); ids.add(member.userId); memberIds.set(member.entryId, ids); }
    const review = await loadAdminDemoReview(tx, artifact, { match, map, roster }, new Map(entries.map(entry => [entry.id, entry.name])), memberIds);
    return { review, quality: projectAdminDemoQuality(artifact, { mapOrder: map.mapOrder, mapName: map.mapName }) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  await enrichAdminDemoReviewPersonas([result.review]);
  return result;
}
