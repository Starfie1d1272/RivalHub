import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DB, type TxDb } from "@/db/client";
import { competitionEntries, matchCommentators, matches, seasonAdminGrants, steamProfiles, users } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/identity/display-name";
import { sortAdminMatches } from "./shared";

export interface AdminMatchCommentaryAssignment {
  commentators: { userId: string; name: string }[];
  isMine: boolean;
  canClaim: boolean;
}

export interface AdminCommentaryMatch {
  id: string;
  teamAName: string;
  teamBName: string;
  scheduledAt: Date | null;
  status: "scheduled" | "in_progress";
}

export interface AdminMatchCommentaryData {
  currentMatches: AdminCommentaryMatch[];
  nextMatch: AdminCommentaryMatch | null;
  unclaimedMatches: AdminCommentaryMatch[];
  unclaimedCount: number;
  byMatchId: Record<string, AdminMatchCommentaryAssignment>;
}

/** Server-authorized, season-scoped facts; deliberately independent of list filters. */
export async function loadAdminMatchCommentary(seasonId: string, options: { excludeMatchId?: string } = {}): Promise<AdminMatchCommentaryData> {
  const admin = await requireSeasonAdmin(seasonId);
  return readAdminMatchCommentary(db, { seasonId, currentUserId: admin.userId, ...options });
}

/** Database read owner. Callers must authorize the season before projecting it. */
export async function readAdminMatchCommentary(
  database: DB | TxDb,
  { seasonId, currentUserId, excludeMatchId }: { seasonId: string; currentUserId: string; excludeMatchId?: string },
): Promise<AdminMatchCommentaryData> {
  const teamA = alias(competitionEntries, "commentary_team_a");
  const teamB = alias(competitionEntries, "commentary_team_b");
  const [matchRows, grants] = await Promise.all([
    database.select({
      id: matches.id,
      teamAName: teamA.name,
      teamBName: teamB.name,
      status: matches.status,
      scheduledAt: matches.scheduledAt,
      completedAt: matches.completedAt,
    }).from(matches)
      .innerJoin(teamA, eq(teamA.id, matches.entryAId))
      .innerJoin(teamB, eq(teamB.id, matches.entryBId))
      .where(eq(matches.seasonId, seasonId))
      .orderBy(asc(matches.id)),
    database.select({ userId: seasonAdminGrants.userId }).from(seasonAdminGrants)
      .where(and(eq(seasonAdminGrants.seasonId, seasonId), eq(seasonAdminGrants.userId, currentUserId))),
  ]);
  const commentatorRows = matchRows.length === 0 ? [] : await database.select({
    matchId: matchCommentators.matchId,
    userId: users.id,
    email: users.email,
    displayName: users.displayName,
    personaName: steamProfiles.personaName,
    perfectName: users.perfectName,
  }).from(matchCommentators)
    .innerJoin(users, eq(users.id, matchCommentators.userId))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(inArray(matchCommentators.matchId, matchRows.map((match) => match.id)))
    .orderBy(asc(matchCommentators.userId));
  const commentatorsByMatch = new Map<string, AdminMatchCommentaryAssignment["commentators"]>();
  for (const row of commentatorRows) {
    const commentators = commentatorsByMatch.get(row.matchId) ?? [];
    commentators.push({ userId: row.userId, name: getDisplayName(row) });
    commentatorsByMatch.set(row.matchId, commentators);
  }

  // Super-admin access alone does not make someone an eligible actual caster.
  const isSeasonAdmin = grants.some((grant) => grant.userId === currentUserId);
  const byMatchId: AdminMatchCommentaryData["byMatchId"] = {};
  const activeMatches: AdminCommentaryMatch[] = [];
  for (const match of sortAdminMatches(matchRows)) {
    const commentators = commentatorsByMatch.get(match.id) ?? [];
    const isMine = commentators.some((person) => person.userId === currentUserId);
    const active = match.status === "scheduled" || match.status === "in_progress";
    byMatchId[match.id] = { commentators, isMine, canClaim: isSeasonAdmin && active && !isMine && commentators.length < 2 };
    if ((match.status === "scheduled" || match.status === "in_progress") && match.id !== excludeMatchId) {
      activeMatches.push({ id: match.id, teamAName: match.teamAName, teamBName: match.teamBName, status: match.status, scheduledAt: match.scheduledAt });
    }
  }
  const unclaimed = activeMatches.filter((match) => byMatchId[match.id]!.commentators.length === 0);
  return {
    currentMatches: activeMatches.filter((match) => match.status === "in_progress" && byMatchId[match.id]!.isMine),
    nextMatch: activeMatches.find((match) => match.status === "scheduled" && byMatchId[match.id]!.isMine) ?? null,
    unclaimedMatches: unclaimed.slice(0, 5),
    unclaimedCount: unclaimed.length,
    byMatchId,
  };
}
