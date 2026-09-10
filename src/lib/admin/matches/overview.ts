import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  majorFinalResults,
  majorStageRuns,
  matchCommentators,
  matches,
  postMatchReports,
  seasonAdminGrants,
  seasons,
  users,
} from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getMatchMapRoundScores } from "@/lib/data/standings";
import { getDisplayName } from "@/lib/identity/display-name";
import { calculateStandings } from "@/lib/standings";
import {
  buildStageViews,
  resolveDefaultStageKey,
} from "@/lib/matches/stage-views";
import { resolveStrictHistoricalRoundRobinEntryIds } from "@/lib/matches/historical-round-robin";
import { loadStageBracketEntrantIds } from "@/lib/bracket";
import { loadMajorSwissStageReadModel } from "@/lib/matches/stage-read-model";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { resolveMajorStagePlan } from "@/lib/major/run-snapshot";
import { buildMajorRuntimeData } from "@/lib/admin/major-runtime";
import type { Match } from "@/db/schema";
import type { AdminCommentaryEffectiveness, AdminMatchOverviewData } from "@/lib/admin/matches/types";
import { buildBatchDeadlineGroups, projectAdminMatchSummary, sortAdminMatches } from "@/lib/admin/matches/shared";

export interface AdminMatchOverviewFilter {
  seasonSlug: string;
  stage?: string;
  status?: string;
  team?: string;
}

async function loadCommentaryEffectiveness(
  seasonId: string,
  allMatches: readonly Match[],
): Promise<AdminCommentaryEffectiveness[]> {
  const candidateMatchIds = allMatches
    .filter((match) => match.status === "finished" && Boolean(match.videoUrl))
    .map((match) => match.id);
  if (candidateMatchIds.length === 0) return [];

  const [commentatorRows, seasonAdminRows] = await Promise.all([
    // Only existence of the report and assignment facts is needed here; the
    // full post-match graph remains scoped to the match workbench.
    db
      .select({ matchId: matchCommentators.matchId, userId: matchCommentators.userId })
      .from(matchCommentators)
      .innerJoin(postMatchReports, eq(postMatchReports.matchId, matchCommentators.matchId))
      .where(inArray(matchCommentators.matchId, candidateMatchIds)),
    db
      .select({
        userId: users.id,
        displayName: users.displayName,
        perfectName: users.perfectName,
        steamName: users.steamName,
        liveStreamUrl: users.liveStreamUrl,
      })
      .from(seasonAdminGrants)
      .innerJoin(users, eq(seasonAdminGrants.userId, users.id))
      .where(eq(seasonAdminGrants.seasonId, seasonId)),
  ]);

  const matchIdsByCommentator = new Map<string, Set<string>>();
  for (const row of commentatorRows) {
    const matchIds = matchIdsByCommentator.get(row.userId) ?? new Set<string>();
    matchIds.add(row.matchId);
    matchIdsByCommentator.set(row.userId, matchIds);
  }
  const summaryByMatchId = new Map(allMatches.map((match) => [match.id, projectAdminMatchSummary(match)]));

  return seasonAdminRows
    .map((row) => {
      const matchIds = matchIdsByCommentator.get(row.userId) ?? new Set<string>();
      return {
        admin: {
          userId: row.userId,
          name: getDisplayName(row),
          hasLiveStream: Boolean(row.liveStreamUrl),
        },
        matches: candidateMatchIds
          .filter((matchId) => matchIds.has(matchId))
          .map((matchId) => summaryByMatchId.get(matchId))
          .filter((match): match is ReturnType<typeof projectAdminMatchSummary> => match !== undefined),
      };
    })
    .filter(({ matches: effectiveMatches }) => effectiveMatches.length > 0);
}

/**
 * Season-level read model only. Detail tables (event roster, match roster,
 * veto, post-match and OCR) belong to the match workbench loader.
 */
export async function loadAdminMatchOverview({
  seasonSlug,
  stage: filterStage,
  status: filterStatus,
  team: filterTeam,
}: AdminMatchOverviewFilter): Promise<AdminMatchOverviewData | null> {
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) return null;
  await requireSeasonAdmin(season.id);

  const isMajor = season.competitionTemplate === "major";
  const [allTeams, allMatches, stageRunRows, finalResult] = await Promise.all([
    db.query.competitionEntries.findMany({
      where: eq(competitionEntries.competitionId, season.id),
      orderBy: [asc(competitionEntries.formationOrder)],
    }),
    db.query.matches.findMany({
      where: eq(matches.seasonId, season.id),
      orderBy: [asc(matches.createdAt)],
    }),
    isMajor
      ? db
          .select({ id: majorStageRuns.id, stageKey: majorStageRuns.stageKey, finalizedRound: majorStageRuns.finalizedRound, ruleSnapshot: majorStageRuns.ruleSnapshot })
          .from(majorStageRuns)
          .where(eq(majorStageRuns.seasonId, season.id))
      : Promise.resolve([] as { id: string; stageKey: string; finalizedRound: number; ruleSnapshot: unknown }[]),
    isMajor
      ? db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) })
      : Promise.resolve(undefined),
  ]);

  const stagePlan = isMajor
    ? resolveMajorStagePlan(normalizeStagePlan(season.stagePlan), stageRunRows)
    : normalizeStagePlan(season.stagePlan);
  const stageReadModels = new Map(
    (await Promise.all(
      stagePlan
        .filter((stage) => stage.type === "swiss")
        .map(async (stage) => [stage.key, await loadMajorSwissStageReadModel(season.id, stage.key)] as const),
    )).filter((entry): entry is readonly [string, NonNullable<typeof entry[1]>] => entry[1] !== null),
  );
  const { swissRuntime, playoffRuntime } = isMajor
    ? buildMajorRuntimeData({
        seasonId: season.id,
        stageRuns: stageRunRows,
        matches: allMatches,
        finalResultStatus: finalResult?.status,
      })
    : { swissRuntime: null, playoffRuntime: null };

  const statusFilter = (match: { status: string }) =>
    !filterStatus || filterStatus === "all" || match.status === filterStatus;
  const teamFilter = (match: { entryAId: string; entryBId: string }) =>
    !filterTeam || filterTeam === "all" || match.entryAId === filterTeam || match.entryBId === filterTeam;

  const { views: allStageViews, unconfiguredMatches } = buildStageViews(stagePlan, allMatches);
  const stageViews = allStageViews.map(({ stage, matches: stageMatches }) => ({
    stage,
    matches: sortAdminMatches(
      stageMatches.filter(statusFilter).filter(teamFilter),
    ).map(projectAdminMatchSummary),
  }));
  const projectedMatches = allMatches.map(projectAdminMatchSummary);
  const commentaryEffectiveness = await loadCommentaryEffectiveness(season.id, allMatches);

  const finishedMatchIds = allMatches
    .filter((match) => match.status === "finished")
    .map((match) => match.id);
  const roundScoresByMatchId = await getMatchMapRoundScores(finishedMatchIds);
  const stageEntrantIdsByKey = await loadStageBracketEntrantIds(db, season.id);

  const standingsByStage = new Map(
    allStageViews
      .filter((view) => view.stage.type === "round_robin" && view.matches.length > 0)
      .map((view) => [
        view.stage.key,
        calculateStandings(
          allTeams.filter((team) => {
            const providerIds = stageEntrantIdsByKey.get(view.stage.key);
            const entryIds = providerIds && providerIds.length > 0
              ? providerIds
              : resolveStrictHistoricalRoundRobinEntryIds(view.stage.teamCount, view.matches);
            return entryIds?.includes(team.id) ?? false;
          }),
          view.matches.filter((match) => match.status === "finished"),
          roundScoresByMatchId,
        ),
      ]),
  );
  const matchCount = allMatches.length;
  const hasSwissStage = stagePlan.some((stage) => stage.type === "swiss");
  const canGenerate = season.status === "playing" && matchCount === 0 && allTeams.length >= 2 && !hasSwissStage;

  return {
    season: {
      id: season.id,
      slug: season.slug,
      name: season.name,
      status: season.status,
    },
    teams: allTeams.map((team) => ({ id: team.id, name: team.name })),
    stagePlan,
    matches: projectedMatches,
    stageViews,
    stageReadModels,
    commentaryEffectiveness,
    unconfiguredMatches: unconfiguredMatches.map(projectAdminMatchSummary),
    standingsByStage,
    batchDeadlineGroups: buildBatchDeadlineGroups(allMatches, stagePlan),
    canGenerate,
    hasSwissStage,
    defaultStageKey: resolveDefaultStageKey(stagePlan, allMatches, filterStage),
    swissRuntime,
    playoffRuntime,
  };
}
