import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, matches, matchTimeProposals, steamProfiles, users } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/identity/display-name";
import { PROPOSAL_RESPONSE_HOURS } from "@/lib/matches/time-rules";
import { requireCompetitionFields } from "@/lib/matches/competition-context";
import { officialMatchCondition } from "@/lib/matches/scope";
import { projectMatchScheduling } from "@/lib/matches/time-rules";
import type { AdminMatchCommentaryData } from "./commentary";
import { proposingEntryId } from "@/lib/matches/time-proposal-side";

export interface AdminMatchOperationsRow {
  id: string;
  stage: string;
  round: number | null;
  entryAId: string;
  entryBId: string;
  scheduledAt: Date | null;
  completionDeadline: Date | null;
  scheduling: ReturnType<typeof projectMatchScheduling>;
  responseDueAt: Date | null;
  teams: { id: string; name: string; representative: { userId: string; name: string; qq: string | null } | null }[];
  awaitingEntryIds: string[];
  commentators: AdminMatchCommentaryData["byMatchId"][string]["commentators"];
  conflicts: { userId: string; name: string; matchId: string; isTest: boolean; scheduledAt: Date }[];
}

/** Admin-only bounded facts. Public DTOs never import this contact projection. */
export async function loadAdminMatchOperations(seasonId: string, commentary: AdminMatchCommentaryData): Promise<AdminMatchOperationsRow[]> {
  await requireSeasonAdmin(seasonId);
  const matchRows = await db.select({
    id: matches.id, stage: matches.stage, round: matches.round,
    entryAId: matches.entryAId, entryBId: matches.entryBId,
    status: matches.status, scheduledAt: matches.scheduledAt, completionDeadline: matches.completionDeadline,
    isTest: sql<boolean>`${matches.testConfig} IS NOT NULL`,
  }).from(matches).where(and(eq(matches.seasonId, seasonId), inArray(matches.status, ["scheduled", "in_progress"]))).orderBy(asc(matches.scheduledAt), asc(matches.createdAt));
  const officialIds = matchRows.filter(row => !row.isTest).map(row => row.id);
  if (officialIds.length === 0) return [];
  const entryIds = [...new Set(matchRows.flatMap(row => [row.entryAId, row.entryBId]).filter((id): id is string => id !== null))];
  const [entries, proposals] = await Promise.all([
    db.select({ id: competitionEntries.id, name: competitionEntries.name, userId: users.id,
      displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName, qq: users.qq,
    }).from(competitionEntries)
      .leftJoin(users, eq(users.id, competitionEntries.representativeUserId))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(and(eq(competitionEntries.competitionId, seasonId), inArray(competitionEntries.id, entryIds))),
    db.select({ matchId: matchTimeProposals.matchId, proposedByEntryId: proposingEntryId(),
      createdAt: matchTimeProposals.createdAt, proposedTime: matchTimeProposals.proposedTime,
    }).from(matchTimeProposals).innerJoin(matches, eq(matches.id, matchTimeProposals.matchId))
      .where(and(officialMatchCondition(), eq(matches.seasonId, seasonId), inArray(matchTimeProposals.matchId, officialIds), eq(matchTimeProposals.status, "pending")))
      .orderBy(asc(matchTimeProposals.createdAt)),
  ]);
  const teamsById = new Map(entries.map(entry => [entry.id, {
    id: entry.id, name: entry.name,
    representative: entry.userId ? { userId: entry.userId, name: getDisplayName(entry), qq: entry.qq } : null,
  }]));
  const pendingByMatch = new Map(proposals.map(proposal => [proposal.matchId, proposal]));
  const now = new Date();
  return matchRows.filter(row => !row.isTest).map(requireCompetitionFields).map(row => {
    const entryAId = row.entryAId!;
    const entryBId = row.entryBId!;
    const proposal = pendingByMatch.get(row.id) ?? null;
    const scheduling = projectMatchScheduling(row, proposal, now);
    const commentators = commentary.byMatchId[row.id]?.commentators ?? [];
    const conflicts = row.scheduledAt ? matchRows.flatMap(other => {
      if (other.id === row.id || other.scheduledAt?.getTime() !== row.scheduledAt!.getTime()) return [];
      return commentators.filter(person => commentary.byMatchId[other.id]?.commentators.some(p => p.userId === person.userId))
        .map(person => ({ userId: person.userId, name: person.name, matchId: other.id, isTest: other.isTest, scheduledAt: other.scheduledAt! }));
    }) : [];
    return {
      id: row.id, stage: row.stage, round: row.round, entryAId, entryBId,
      scheduledAt: row.scheduledAt, completionDeadline: row.completionDeadline, scheduling,
      responseDueAt: scheduling.pending ? new Date(scheduling.pending.createdAt.getTime() + PROPOSAL_RESPONSE_HOURS * 60 * 60_000) : null,
      teams: [teamsById.get(entryAId), teamsById.get(entryBId)].filter((team): team is NonNullable<typeof team> => Boolean(team)),
      awaitingEntryIds: scheduling.state === "unproposed" ? [entryAId, entryBId] : scheduling.pending && proposal ? [entryAId, entryBId].filter(id => id !== proposal.proposedByEntryId) : [],
      commentators, conflicts,
    };
  });
}
