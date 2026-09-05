import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  eventRosterMembers,
  eventRosters,
  matchCommentators,
  matchMaps,
  matchRosterPlayers,
  matchRosters,
  matches,
  postMatchReports,
  seasonAdminGrants,
  seasonRegistrations,
  seasons,
  users,
} from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getStartingLineupPreflightInTx } from "@/lib/match-rosters/service";
import { getDisplayName } from "@/lib/identity/display-name";
import { getPostMatchCompletion, POST_MATCH_COMPLETION_LABEL } from "@/lib/postmatch/service";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/types/season";
import type { AdminMatchWorkbenchData, RosterData, TeamMemberData } from "@/lib/admin/matches/types";
import { mapCompletedMaps, mapFinishedMaps, mapPendingMaps } from "@/lib/admin/matches/shared";

interface AdminMatchWorkbenchInput {
  seasonSlug: string;
  matchId: string;
}

type MatchRosterWithPlayers = typeof matchRosters.$inferSelect & {
  players: (typeof matchRosterPlayers.$inferSelect)[];
};

async function loadMatchRosters(matchId: string): Promise<MatchRosterWithPlayers[]> {
  const rosters = await db.select().from(matchRosters).where(eq(matchRosters.matchId, matchId));
  if (rosters.length === 0) return [];

  const players = await db
    .select()
    .from(matchRosterPlayers)
    .where(inArray(matchRosterPlayers.rosterId, rosters.map((roster) => roster.id)));
  const playersByRoster = new Map<string, (typeof matchRosterPlayers.$inferSelect)[]>();
  for (const player of players) {
    const list = playersByRoster.get(player.rosterId) ?? [];
    list.push(player);
    playersByRoster.set(player.rosterId, list);
  }
  return rosters.map((roster) => ({ ...roster, players: playersByRoster.get(roster.id) ?? [] }));
}

function projectRoster(roster: MatchRosterWithPlayers | undefined): RosterData | null {
  if (!roster) return null;
  return {
    rosterId: roster.id,
    starters: roster.players.filter((player) => player.isStarter).map((player) => player.eventRosterMemberId),
    substitutes: roster.players.filter((player) => !player.isStarter).map((player) => player.eventRosterMemberId),
    status: roster.status,
  };
}

function projectTeamMember(row: {
  id: string;
  entryId: string;
  steamName: string | null;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string | null;
}): TeamMemberData {
  return {
    id: row.id,
    entryId: row.entryId,
    steamName: row.steamName ?? "未知",
    displayName: row.displayName ?? null,
    perfectName: row.perfectName ?? null,
    primaryPosition: row.primaryPosition ?? "—",
  };
}

/**
 * Match-level read model. It is the only admin route that loads roster,
 * veto/map, result, post-match and OCR-adjacent facts for a specific match.
 */
export async function loadAdminMatchWorkbench({
  seasonSlug,
  matchId,
}: AdminMatchWorkbenchInput): Promise<AdminMatchWorkbenchData | null> {
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) return null;

  // Scope the lookup itself so a guessed match id can never cross seasons.
  const match = await db.query.matches.findFirst({
    where: and(eq(matches.id, matchId), eq(matches.seasonId, season.id)),
  });
  if (!match || match.seasonId !== season.id) return null;
  await requireSeasonAdmin(season.id);

  const entryIds = [match.entryAId, match.entryBId];
  const entries = await db.query.competitionEntries.findMany({
    where: and(eq(competitionEntries.competitionId, season.id), inArray(competitionEntries.id, entryIds)),
  });
  if (entries.length !== 2) return null;

  const [memberRows, rosterRows, mapRecords, commentatorRows, submission, seasonAdminRows] = await Promise.all([
    db
      .select({
        id: eventRosterMembers.id,
        entryId: eventRosters.entryId,
        steamName: users.steamName,
        displayName: users.displayName,
        perfectName: users.perfectName,
        primaryPosition: seasonRegistrations.primaryPosition,
      })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .innerJoin(users, eq(eventRosterMembers.userId, users.id))
      .leftJoin(
        seasonRegistrations,
        and(
          eq(seasonRegistrations.userId, eventRosterMembers.userId),
          eq(seasonRegistrations.seasonId, season.id),
        ),
      )
      .where(inArray(eventRosters.entryId, entryIds)),
    loadMatchRosters(match.id),
    db.query.matchMaps.findMany({
      where: eq(matchMaps.matchId, match.id),
      orderBy: [asc(matchMaps.mapOrder)],
    }),
    match.status !== "cancelled"
      ? db
          .select({
            matchId: matchCommentators.matchId,
            userId: users.id,
            displayName: users.displayName,
            perfectName: users.perfectName,
            steamName: users.steamName,
            liveStreamUrl: users.liveStreamUrl,
          })
          .from(matchCommentators)
          .innerJoin(users, eq(matchCommentators.userId, users.id))
          .where(eq(matchCommentators.matchId, match.id))
      : Promise.resolve([]),
    match.status !== "cancelled"
      ? db.query.postMatchReports.findFirst({ where: eq(postMatchReports.matchId, match.id) })
      : Promise.resolve(undefined),
    match.status !== "cancelled"
      ? db
          .select({
            userId: users.id,
            displayName: users.displayName,
            perfectName: users.perfectName,
            steamName: users.steamName,
            liveStreamUrl: users.liveStreamUrl,
          })
          .from(seasonAdminGrants)
          .innerJoin(users, eq(seasonAdminGrants.userId, users.id))
          .where(eq(seasonAdminGrants.seasonId, season.id))
      : Promise.resolve([]),
  ]);

  const members = memberRows.map(projectTeamMember);
  const membersByEntry = new Map<string, TeamMemberData[]>();
  for (const member of members) {
    const list = membersByEntry.get(member.entryId) ?? [];
    list.push(member);
    membersByEntry.set(member.entryId, list);
  }

  const rostersByEntry = new Map(rosterRows.map((roster) => [roster.entryId, roster]));
  let teamAPreflight = null;
  let teamBPreflight = null;
  if (match.status === "scheduled" && match.ownership === "major_stage") {
    const preflightRows = await Promise.all(entryIds.map(async (entryId) => {
      const roster = rostersByEntry.get(entryId);
      if (!roster) return { entryId, preflight: null };
      const result = await db.transaction((tx) => getStartingLineupPreflightInTx(tx, {
        match,
        entryId,
        starterIds: roster.players.filter((player) => player.isStarter).map((player) => player.eventRosterMemberId),
        substituteIds: roster.players.filter((player) => !player.isStarter).map((player) => player.eventRosterMemberId),
      }));
      return { entryId, preflight: { valid: result.valid, blockers: result.blockers } };
    }));
    teamAPreflight = preflightRows.find((row) => row.entryId === match.entryAId)?.preflight ?? null;
    teamBPreflight = preflightRows.find((row) => row.entryId === match.entryBId)?.preflight ?? null;
  }

  const stagePlan = normalizeStagePlan(season.stagePlan);
  const entryName = new Map(entries.map((entry) => [entry.id, entry.name]));
  const submittedAt = submission?.submittedAt ?? null;
  const postMatch = match.status === "cancelled"
    ? null
    : {
        commentators: commentatorRows.map((row) => ({
          userId: row.userId,
          name: getDisplayName(row),
          hasLiveStream: Boolean(row.liveStreamUrl),
        })),
        seasonAdmins: seasonAdminRows.map((row) => ({
          userId: row.userId,
          name: getDisplayName(row),
          hasLiveStream: Boolean(row.liveStreamUrl),
        })),
        submittedAt,
        submittedByUserId: submission?.submittedByUserId ?? null,
        videoUrl: match.videoUrl,
        completionLabel: POST_MATCH_COMPLETION_LABEL[getPostMatchCompletion(submittedAt, match.videoUrl)],
        canSubmit: match.status === "finished",
      };

  return {
    season: { id: season.id, slug: season.slug, name: season.name },
    stageName: stagePlan.find((stage) => stage.key === match.stage)?.name ?? null,
    match,
    teamAName: entryName.get(match.entryAId) ?? "未知队伍",
    teamBName: entryName.get(match.entryBId) ?? "未知队伍",
    mapPool: normalizeRegistrationConfig(season.registrationConfig).mapPool,
    teamAMembers: membersByEntry.get(match.entryAId) ?? [],
    teamBMembers: membersByEntry.get(match.entryBId) ?? [],
    teamARoster: projectRoster(rostersByEntry.get(match.entryAId)),
    teamBRoster: projectRoster(rostersByEntry.get(match.entryBId)),
    teamAPreflight,
    teamBPreflight,
    completedMaps: mapCompletedMaps(mapRecords),
    pendingMaps: mapPendingMaps(mapRecords),
    finishedMaps: mapFinishedMaps(mapRecords),
    postMatch,
  };
}
