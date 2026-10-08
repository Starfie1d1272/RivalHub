import "server-only";
import { requireCompetitionFields } from "@/lib/matches/competition-context";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DB, type TxDb } from "@/db/client";
import { competitionEntries, matchCommentators, matchLiveSessions, matchVetoSessions, matches, steamProfiles, users } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/identity/display-name";
import { getPublicPlayerIdentityIds } from "@/lib/players/public-identity";
import { commentaryAdminEligibility } from "@/lib/postmatch/eligibility";
import { commentaryCancellationBlocker } from "@/lib/postmatch/commentary-policy";
import { sortAdminMatches } from "./shared";

export interface AdminMatchCommentaryAssignment {
  commentators: { userId: string; name: string; playerUserId: string | null }[];
  isMine: boolean;
  canClaim: boolean;
  canCancel: boolean;
  cancellationBlockedReason: string | null;
}

export interface AdminCommentaryMatch {
  id: string;
  entryAId: string;
  entryBId: string;
  isTest?: boolean;
  teamAName: string;
  teamBName: string;
  scheduledAt: Date | null;
  status: "scheduled" | "in_progress";
}

export interface AdminMatchCommentaryData {
  currentMatches: AdminCommentaryMatch[];
  nextMatch: AdminCommentaryMatch | null;
  claimableMatches: AdminCommentaryMatch[];
  claimableCount: number;
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
  const [matchRows, eligibleUsers] = await Promise.all([
    database.select({
      id: matches.id,
      testConfig: matches.testConfig,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      status: matches.status,
      scheduledAt: matches.scheduledAt,
      completedAt: matches.completedAt,
      vetoStartedAt: matchVetoSessions.startedAt,
      activeSourceId: matchLiveSessions.id,
    }).from(matches)
      .leftJoin(matchVetoSessions, eq(matchVetoSessions.matchId, matches.id))
      .leftJoin(matchLiveSessions, and(eq(matchLiveSessions.matchId, matches.id), isNull(matchLiveSessions.closedAt)))
      .innerJoin(teamA, eq(teamA.id, matches.entryAId))
      .innerJoin(teamB, eq(teamB.id, matches.entryBId))
      .where(eq(matches.seasonId, seasonId))
      .orderBy(asc(matches.id)),
    database.select({ userId: users.id }).from(users)
      .where(and(eq(users.id, currentUserId), commentaryAdminEligibility(seasonId))),
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
  const playerIds = await getPublicPlayerIdentityIds(database, commentatorRows.map(row => row.userId));
  const commentatorsByMatch = new Map<string, AdminMatchCommentaryAssignment["commentators"]>();
  for (const row of commentatorRows) {
    const commentators = commentatorsByMatch.get(row.matchId) ?? [];
    commentators.push({ userId: row.userId, name: getDisplayName(row), playerUserId: playerIds.has(row.userId) ? row.userId : null });
    commentatorsByMatch.set(row.matchId, commentators);
  }

  const canCommentate = eligibleUsers.length > 0;
  const byMatchId: AdminMatchCommentaryData["byMatchId"] = {};
  const activeMatches: AdminCommentaryMatch[] = [];
  for (const match of sortAdminMatches(matchRows.map(requireCompetitionFields))) {
    const commentators = commentatorsByMatch.get(match.id) ?? [];
    const isMine = commentators.some((person) => person.userId === currentUserId);
    const active = match.status === "scheduled" || match.status === "in_progress";
    const cancellationBlockedReason = isMine ? commentaryCancellationBlocker(match) : null;
    byMatchId[match.id] = { commentators, isMine, canClaim: canCommentate && active && !isMine && commentators.length < 2, canCancel: canCommentate && isMine && cancellationBlockedReason === null, cancellationBlockedReason };
    if ((match.status === "scheduled" || match.status === "in_progress") && match.id !== excludeMatchId) {
      activeMatches.push({ id: match.id, isTest: Boolean(match.testConfig), entryAId: match.entryAId, entryBId: match.entryBId, teamAName: match.teamAName, teamBName: match.teamBName, status: match.status, scheduledAt: match.scheduledAt });
    }
  }
  const claimable = activeMatches.filter((match) => byMatchId[match.id]!.canClaim);
  return {
    currentMatches: activeMatches.filter((match) => match.status === "in_progress" && byMatchId[match.id]!.isMine),
    nextMatch: activeMatches.find((match) => match.status === "scheduled" && byMatchId[match.id]!.isMine) ?? null,
    claimableMatches: claimable,
    claimableCount: claimable.length,
    byMatchId,
  };
}
