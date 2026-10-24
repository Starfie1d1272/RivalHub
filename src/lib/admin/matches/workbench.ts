import { traceOperation } from "@/lib/observability/server";
import { findAdminSeasonBySlug } from "@/lib/admin/season-context";
import { hasMatchRecording } from "@/lib/postmatch/recording-types";
import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import "server-only";

import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  eventRosterMembers,
  eventRosters,
  matchDemoImports,
  matchCommentators,
  matchMaps,
  matchRosterPlayers,
  matchRosters,
  matchVetoSessions,
  matches,
  postMatchReports,
  seasonRegistrations,
  steamProfiles,
  users,
} from "@/db/schema";
import { commentaryAdminEligibility } from "@/lib/postmatch/eligibility";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getStartingLineupPreflightInTx } from "@/lib/match-rosters/service";
import { requiresCompetitionLineupPreflight } from "@/lib/match-rosters/policy";
import { ErrorCode, isAppErrorCode } from "@/lib/errors";
import { mapLabel } from "@/lib/maps";
import { getDisplayName } from "@/lib/identity/display-name";
import { getPostMatchCompletion, POST_MATCH_COMPLETION_LABEL } from "@/lib/postmatch/completion";
import { readReopenedPostMatchIds } from "@/lib/postmatch/read";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/lib/seasons/compatibility";
import { loadMatchRosters } from "@/lib/match-rosters/read-model";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { demoImportMetadataSelection } from "@/lib/demo-integration/metadata";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { enrichAdminDemoReviewPersonas } from "./demo-personas";
import { loadAdminDemoReview } from "./demo-review";
import { projectAdminDemoQuality } from "./demo-quality";
import type { AdminDemoReviewMap, AdminMatchWorkbenchData, RosterData, TeamMemberData } from "@/lib/admin/matches/types";
import { mapCompletedMaps, mapFinishedMaps, mapPendingMaps } from "@/lib/admin/matches/shared";
import { projectOperatorCompletion } from "./operator-workflow";
import { loadOperatorContext } from "./operator-context";
import { readAdminMatchCommentary } from "./commentary";

interface AdminMatchWorkbenchInput {
  seasonSlug: string;
  matchId: string;
}

type MatchRosterWithPlayers = typeof matchRosters.$inferSelect & {
  players: (typeof matchRosterPlayers.$inferSelect)[];
};

function projectRoster(roster: MatchRosterWithPlayers | undefined): RosterData | null {
  if (!roster) return null;
  return {
    rosterId: roster.id,
    starters: roster.players.filter((player) => player.isStarter).map((player) => player.eventRosterMemberId),
    substitutes: roster.players.filter((player) => !player.isStarter).map((player) => player.eventRosterMemberId),
    vetoRepresentativeEventRosterMemberId: roster.players.find((player) => player.isVetoRepresentative)?.eventRosterMemberId ?? null,
    status: roster.status,
  };
}

function projectTeamMember(row: {
  userId: string;
  id: string;
  entryId: string;
  personaName: string | null;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string | null;
  isCurrent: boolean;
}): TeamMemberData {
  return {
    id: row.id,
    userId: row.userId,
    entryId: row.entryId,
    personaName: row.personaName ?? null,
    displayName: row.displayName ?? null,
    perfectName: row.perfectName ?? null,
    primaryPosition: row.primaryPosition ?? "—",
    isCurrent: row.isCurrent,
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
  const season = await findAdminSeasonBySlug(seasonSlug);
  if (!season) return null;

  // Scope the lookup itself so a guessed match id can never cross seasons.
  const match = await db.query.matches.findFirst({
    where: and(eq(matches.id, matchId), eq(matches.seasonId, season.id)),
  });
  if (!match || match.seasonId !== season.id) return null;
  assertCompetitionMatch(match);
  const admin = await requireSeasonAdmin(season.id);

  const entryIds = [match.entryAId, match.entryBId];
  const entries = await db.query.competitionEntries.findMany({
    where: and(eq(competitionEntries.competitionId, season.id), inArray(competitionEntries.id, entryIds)),
  });
  if (entries.length !== 2) return null;

  const [memberRows, rosterRows, mapRecords, commentatorRows, submission, seasonAdminRows, effectiveRosterRows, reopenedIds, vetoSession] = await Promise.all([
    db
      .select({
        id: eventRosterMembers.id,
        userId: users.id,
        entryId: eventRosters.entryId,
        eventRosterStatus: eventRosters.status,
        isCurrent: eventRosterMembers.isCurrent,
        personaName: steamProfiles.personaName,
        displayName: users.displayName,
        perfectName: users.perfectName,
        primaryPosition: seasonRegistrations.primaryPosition,
      })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .innerJoin(users, eq(eventRosterMembers.userId, users.id))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .leftJoin(
        seasonRegistrations,
        and(
          eq(seasonRegistrations.userId, eventRosterMembers.userId),
          eq(seasonRegistrations.seasonId, season.id),
        ),
      )
      .where(and(
        inArray(eventRosters.entryId, entryIds),
        or(
          eq(eventRosterMembers.isCurrent, true),
          inArray(eventRosterMembers.id, db.select({ memberId: matchRosterPlayers.eventRosterMemberId })
            .from(matchRosterPlayers)
            .innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
            .where(eq(matchRosters.matchId, match.id))),
        ),
      )),
    loadMatchRosters(match.id, entryIds),
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
            personaName: steamProfiles.personaName,
            liveStreamUrl: users.liveStreamUrl,
          })
          .from(matchCommentators)
          .innerJoin(users, eq(matchCommentators.userId, users.id))
          .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
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
            personaName: steamProfiles.personaName,
            liveStreamUrl: users.liveStreamUrl,
          })
          .from(users)
          .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
          .where(commentaryAdminEligibility(season.id))
      : Promise.resolve([]),
    loadEffectiveMatchRoster(db, [match.id]),
    readReopenedPostMatchIds(db, [match.id]),
    db.query.matchVetoSessions.findFirst({
      where: eq(matchVetoSessions.matchId, match.id),
      columns: { completedAt: true },
    }),
  ]);

  const demoImportRows = mapRecords.length > 0
    ? await db.select(demoImportMetadataSelection).from(matchDemoImports)
      .where(inArray(matchDemoImports.matchMapId, mapRecords.map((map) => map.id)))
      .orderBy(desc(matchDemoImports.createdAt))
    : [];

  const eventRosterUserIdsByEntry = new Map<string, Set<string>>();
  for (const member of memberRows) {
    if (member.eventRosterStatus !== "confirmed" && member.eventRosterStatus !== "frozen") continue;
    const ids = eventRosterUserIdsByEntry.get(member.entryId) ?? new Set<string>();
    ids.add(member.userId);
    eventRosterUserIdsByEntry.set(member.entryId, ids);
  }

  const members = memberRows.map(projectTeamMember);
  const membersByEntry = new Map<string, TeamMemberData[]>();
  for (const member of members) {
    const list = membersByEntry.get(member.entryId) ?? [];
    list.push(member);
    membersByEntry.set(member.entryId, list);
  }

  const rostersByEntry = rosterRows;
  let teamAPreflight = null;
  let teamBPreflight = null;
  if (match.status === "scheduled" && requiresCompetitionLineupPreflight(match)) {
    const preflightRows = await Promise.all(entryIds.map(async (entryId) => {
      const roster = rostersByEntry.get(entryId);
      if (!roster) return { entryId, preflight: null };
      try {
        const result = await db.transaction((tx) => getStartingLineupPreflightInTx(tx, {
          match,
          entryId,
          starterIds: roster.players.filter((player) => player.isStarter).map((player) => player.eventRosterMemberId),
          substituteIds: roster.players.filter((player) => !player.isStarter).map((player) => player.eventRosterMemberId),
        }));
        return { entryId, preflight: { valid: result.valid, blockers: result.blockers } };
      } catch (error) {
        if (!isAppErrorCode(error, ErrorCode.VALIDATION_FAILED)) throw error;
        return { entryId, preflight: { valid: false, blockers: [error.message] } };
      }
    }));
    teamAPreflight = preflightRows.find((row) => row.entryId === match.entryAId)?.preflight ?? null;
    teamBPreflight = preflightRows.find((row) => row.entryId === match.entryBId)?.preflight ?? null;
  }

  const stagePlan = normalizeStagePlan(season.stagePlan);
  const entryName = new Map(entries.map((entry) => [entry.id, entry.name]));
  const reviewImportIds: string[] = [];
  const demoQualitySummaries: NonNullable<AdminMatchWorkbenchData["demoQualitySummaries"]> = [];
  for (const map of mapRecords) {
    const rows = demoImportRows.filter((row) => row.matchMapId === map.id);
    const current = selectCurrentDemoImport(rows);
    if (current?.status === "needs_attention") reviewImportIds.push(current.id);
    else if (current?.status === "confirmed") demoQualitySummaries.push({ importId: current.id, matchMapId: map.id, mapOrder: map.mapOrder, mapName: map.mapName });
  }
  // Active reviews need authoritative details now; confirmed QA is advisory and loaded on expansion.
  const reviewImports = reviewImportIds.length
    ? await db.select().from(matchDemoImports).where(inArray(matchDemoImports.id, reviewImportIds))
    : [];
  const currentImportByMap = new Map(reviewImports.map((row) => [row.matchMapId, row]));
  const demoReviews: AdminDemoReviewMap[] = [];
  const demoQuality = mapRecords.flatMap((map) => {
    const row = currentImportByMap.get(map.id);
    return row ? [projectAdminDemoQuality(row, { mapOrder: map.mapOrder, mapName: map.mapName })] : [];
  });
  for (const map of mapRecords) {
    const row = currentImportByMap.get(map.id);
    if (row?.status === "needs_attention") demoReviews.push(await db.transaction((tx) => traceOperation("admin.match.demo-review", { scope: "admin", operation: "match.demo-review", stage: "transaction" }, () => loadAdminDemoReview(
      tx,
      row,
      { match, map, roster: effectiveRosterRows },
      entryName,
      eventRosterUserIdsByEntry,
    ))));
  }
  const submittedAt = submission?.submittedAt ?? null;
  const rosterReopened = reopenedIds.has(match.id) && !submission;
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
        rosterReopened,
        canConfirm: commentatorRows.some(row => row.userId === admin.userId),
        videoUrl: match.videoUrl,
        recordings: match.recordings,
        completionLabel: commentatorRows.length ? POST_MATCH_COMPLETION_LABEL[getPostMatchCompletion(submittedAt, hasMatchRecording(match), rosterReopened)] : "未登记解说，无需提交名单或录像",
        canSubmit: match.status === "finished",
      };

  const stage = stagePlan.find((stage) => stage.key === match.stage);
  const teamAName = entryName.get(match.entryAId) ?? "未知队伍";
  const teamBName = entryName.get(match.entryBId) ?? "未知队伍";
  const [operator, commentary] = await Promise.all([
    loadOperatorContext({ match, maps: mapRecords, imports: demoImportRows, roster: effectiveRosterRows,
      seasonName: season.name, stageName: match.testConfig ? "测试赛" : stage?.name ?? null, isSwiss: stage?.type === "swiss",
      teamAName, teamBName, vetoComplete: Boolean(vetoSession?.completedAt) }),
    readAdminMatchCommentary(db, { seasonId: season.id, currentUserId: admin.userId, excludeMatchId: match.id }),
  ]);

  // Persona is display enrichment, never part of canonical validation or its transaction.
  await enrichAdminDemoReviewPersonas(demoReviews);
  return {
    completion: projectOperatorCompletion({ status: match.status, isForfeit: match.isForfeit, maps: operator.workflow.completedMaps, commentatorCount: commentatorRows.length, submitted: Boolean(submittedAt), reopened: rosterReopened, hasVideo: hasMatchRecording(match) }),
    season: { id: season.id, slug: season.slug, name: season.name },
    stageName: match.testConfig ? "测试赛" : stage?.name ?? null,
    match,
    teamAName,
    teamBName,
    mapPool: match.testConfig?.mapPool ?? normalizeRegistrationConfig(season.registrationConfig).mapPool,
    teamAMembers: membersByEntry.get(match.entryAId) ?? [],
    teamBMembers: membersByEntry.get(match.entryBId) ?? [],
    teamARoster: projectRoster(rostersByEntry.get(match.entryAId)),
    teamBRoster: projectRoster(rostersByEntry.get(match.entryBId)),
    teamAPreflight,
    teamBPreflight,
    completedMaps: mapCompletedMaps(mapRecords),
    officialMapStart: (() => { const next = mapRecords.find(m => !m.completedAt); return match.status === "in_progress" && vetoSession?.completedAt && next && !next.startedAt ? { mapId: next.id, mapName: mapLabel(next.mapName) } : null; })(),
    pendingMaps: match.status === "finished" ? [] : mapPendingMaps(mapRecords),
    finishedMaps: mapFinishedMaps(mapRecords),
    vetoCompletedAt: vetoSession?.completedAt ?? null,
    postMatch,
    demoReviews,
    demoQuality,
    demoQualitySummaries,
    operator,
    commentary,
  };
}
