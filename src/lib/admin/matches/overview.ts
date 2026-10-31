import { withDbTrafficSource } from "@/lib/observability/db-traffic";
import { findAdminSeasonOverviewBySlug } from "@/lib/admin/season-context";
import { hasMatchRecordingCondition } from "@/lib/postmatch/recording-query";
import { hasMatchRecording } from "@/lib/postmatch/recording-types";
import { withDisplayScores } from "@/lib/matches/display-score-data";
import { officialMatchCondition } from "@/lib/matches/scope";
import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import type { CompetitionMatch } from "@/lib/matches/competition-context";
import "server-only";
import { readReopenedPostMatchIds } from "@/lib/postmatch/read";

import { and, asc, count, desc, eq, inArray, notInArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionQualificationRuns,
  majorFinalResults,
  majorStageRuns,
  matchCommentators,
  matchDemoImports,
  matchMaps,
  matches,
  steamProfiles,
  users,
} from "@/db/schema";
import { commentaryAdminEligibility } from "@/lib/postmatch/eligibility";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getMatchMapRoundScores } from "@/lib/data/standings";
import { getDisplayName } from "@/lib/identity/display-name";
import {
  buildStageViews,
  resolveDefaultStageKey,
} from "@/lib/matches/stage-views";
import { calculateStageRoundRobinStandings } from "@/lib/matches/stage-standings";
import { loadStageBracketEntrantIds } from "@/lib/bracket";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { resolveMajorStagePlan } from "@/lib/major/run-snapshot";
import { buildMajorRuntimeData } from "@/lib/admin/major-runtime";
import type { Match as DbMatch } from "@/db/schema";
import type { AdminCommentaryEffectiveness, AdminMatchOverviewData } from "@/lib/admin/matches/types";
import { buildBatchDeadlineGroups, projectAdminMatchSummary, sortAdminMatches } from "@/lib/admin/matches/shared";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";

type Match = CompetitionMatch<DbMatch>;

async function loadDemoNeedsAttentionCounts(matchIds: readonly string[]): Promise<Map<string, number>> {
  if (matchIds.length === 0) return new Map();
  const mapRows = await db.select({ id: matchMaps.id, matchId: matchMaps.matchId })
    .from(matchMaps)
    .where(inArray(matchMaps.matchId, [...matchIds]));
  if (mapRows.length === 0) return new Map();
  const importRows = await db.select({
    matchMapId: matchDemoImports.matchMapId,
    semanticProfile: matchDemoImports.semanticProfile,
    status: matchDemoImports.status,
  }).from(matchDemoImports)
    .where(inArray(matchDemoImports.matchMapId, mapRows.map((row) => row.id)))
    .orderBy(desc(matchDemoImports.createdAt));
  const rowsByMap = new Map<string, typeof importRows>();
  for (const row of importRows) rowsByMap.set(row.matchMapId, [...(rowsByMap.get(row.matchMapId) ?? []), row]);
  const matchIdByMap = new Map(mapRows.map((row) => [row.id, row.matchId]));
  const counts = new Map<string, number>();
  for (const [mapId, rows] of rowsByMap) {
    if (selectCurrentDemoImport(rows)?.status !== "needs_attention") continue;
    const matchId = matchIdByMap.get(mapId);
    if (matchId) counts.set(matchId, (counts.get(matchId) ?? 0) + 1);
  }
  return counts;
}

export interface AdminMatchOverviewFilter {
  seasonSlug: string;
  view?: "execution" | "schedule";
  stage?: string;
  status?: string;
  team?: string;
  page?: string;
}

async function loadCommentaryEffectiveness(
  seasonId: string,
  allMatches: readonly Match[],
): Promise<AdminCommentaryEffectiveness[]> {
  const candidateMatchIds = allMatches
    .filter((match) => match.status === "finished" && hasMatchRecording(match))
    .map((match) => match.id);
  if (candidateMatchIds.length === 0) return [];

  const [allCommentatorRows, seasonAdminRows, reopenedIds] = await Promise.all([
    // Registered commentators are the default; explicit reopening excludes the match.
    db
      .select({ matchId: matchCommentators.matchId, userId: matchCommentators.userId })
      .from(matchCommentators)
      .where(inArray(matchCommentators.matchId, candidateMatchIds)),
    db
      .select({
        userId: users.id,
        displayName: users.displayName,
        perfectName: users.perfectName,
        personaName: steamProfiles.personaName,
        liveStreamUrl: users.liveStreamUrl,
      })
      .from(users)
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(commentaryAdminEligibility(seasonId)),
    readReopenedPostMatchIds(db, candidateMatchIds),
  ]);
  const commentatorRows = allCommentatorRows.filter(row => !reopenedIds.has(row.matchId));

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

/** Independent materials-view read; execution and scheduling do not need this report. */
export async function loadAdminCommentaryEffectiveness(seasonId: string): Promise<AdminCommentaryEffectiveness[]> {
  await requireSeasonAdmin(seasonId);
  const completed = await db.query.matches.findMany({
    where: and(officialMatchCondition(), eq(matches.seasonId, seasonId), eq(matches.status, "finished"), hasMatchRecordingCondition()),
    orderBy: [asc(matches.createdAt)],
  });
  return loadCommentaryEffectiveness(seasonId, completed.map(requireCompetitionMatch));
}

/** Shared authorized configuration; materials do not need the schedule substrate. */
async function loadWorkspaceContext(seasonSlug: string) {
  const season = await findAdminSeasonOverviewBySlug(seasonSlug);
  if (!season) return null;
  await requireSeasonAdmin(season.id);
  const [allTeams, stageRunRows, qualificationRun] = await withDbTrafficSource("admin.matches.read", async () => await Promise.all([
    db.query.competitionEntries.findMany({
      columns: { id: true, name: true, formationOrder: true },
      where: eq(competitionEntries.competitionId, season.id), orderBy: [asc(competitionEntries.formationOrder)],
    }),
    season.competitionTemplate === "major" ? db.select({
      id: majorStageRuns.id, stageKey: majorStageRuns.stageKey, finalizedRound: majorStageRuns.finalizedRound,
      ruleSnapshot: majorStageRuns.ruleSnapshot, startedAt: majorStageRuns.startedAt,
    }).from(majorStageRuns).where(eq(majorStageRuns.seasonId, season.id)) : Promise.resolve([]),
    season.competitionTemplate === "major" ? db.query.competitionQualificationRuns.findFirst({
      where: eq(competitionQualificationRuns.seasonId, season.id),
    }) : Promise.resolve(undefined),
  ]));
  const stagePlan = season.competitionTemplate === "major"
    ? resolveMajorStagePlan(normalizeStagePlan(season.stagePlan), stageRunRows)
    : normalizeStagePlan(season.stagePlan);
  return { season, allTeams, stageRunRows, qualificationRun, stagePlan };
}

function projectWorkspace(context: NonNullable<Awaited<ReturnType<typeof loadWorkspaceContext>>>): Pick<AdminMatchOverviewData, "season" | "teams" | "stagePlan" | "qualificationRun"> {
  const { season, allTeams, stagePlan, qualificationRun } = context;
  return {
    season: { id: season.id, slug: season.slug, name: season.name, status: season.status, competitionTemplate: season.competitionTemplate },
    teams: allTeams.map(({ id, name }) => ({ id, name })), stagePlan,
    qualificationRun: qualificationRun ? { id: qualificationRun.id, format: qualificationRun.format, playInEntryCount: qualificationRun.playInEntryCount, startedAt: qualificationRun.startedAt, completedAt: qualificationRun.completedAt } : null,
  };
}

export async function loadAdminMatchWorkspace(seasonSlug: string) {
  const context = await loadWorkspaceContext(seasonSlug);
  return context ? projectWorkspace(context) : null;
}

/** Execution and scheduling reuse the same match facts and domain rules. */
export async function loadAdminMatchOverview({
  seasonSlug, view = "execution", stage: filterStage, status: filterStatus, team: filterTeam, page: requestedPage,
}: AdminMatchOverviewFilter): Promise<AdminMatchOverviewData | null> {
  const context = await loadWorkspaceContext(seasonSlug);
  if (!context) return null;
  const { season, allTeams, stageRunRows, qualificationRun, stagePlan } = context;
  const isMajor = season.competitionTemplate === "major";
  const scope = and(officialMatchCondition(), eq(matches.seasonId, season.id));
  // Execution discovers stages/counts without fetching every historical match body.
  const stageCounts = view === "execution"
    ? await db.select({ stage: matches.stage, count: count() }).from(matches).where(scope).groupBy(matches.stage)
    : null;
  const stageKeys = [...(qualificationRun ? ["play-in"] : []), ...stagePlan.map(stage => stage.key)];
  const chooseStage = (facts: readonly { stage: string }[]) => filterStage && stageKeys.includes(filterStage)
    ? filterStage
    : isMajor
      ? stageRunRows.filter(run => run.startedAt).sort((a, b) => b.startedAt!.getTime() - a.startedAt!.getTime())[0]?.stageKey
        ?? (qualificationRun ? "play-in" : stagePlan[0]?.key ?? null)
      : resolveDefaultStageKey(stagePlan, facts, filterStage);
  const executionStage = stageCounts ? chooseStage(stageCounts.map(row => ({ stage: row.stage ?? "" }))) : null;
  const configuredKeys = stagePlan.map(stage => stage.key);
  const executionScope = and(scope, or(
    executionStage ? eq(matches.stage, executionStage) : undefined,
    configuredKeys.length ? notInArray(matches.stage, configuredKeys) : undefined,
  ));
  const executionFacts = view === "execution" ? await db.select({
    id: matches.id, stage: matches.stage, status: matches.status,
    entryAId: matches.entryAId, entryBId: matches.entryBId,
    scheduledAt: matches.scheduledAt, completedAt: matches.completedAt,
    qualificationRunId: matches.qualificationRunId, ownership: matches.ownership,
    majorStageRunId: matches.majorStageRunId, managedKey: matches.managedKey, bracketNodeId: matches.bracketNodeId,
  }).from(matches).where(configuredKeys.length ? executionScope : scope)
    .orderBy(asc(matches.createdAt), asc(matches.id)) : null;
  const isQualificationMatch = (match: NonNullable<typeof executionFacts>[number]) => Boolean(qualificationRun &&
    match.qualificationRunId === qualificationRun.id && match.stage === "play-in" && match.ownership === "manual" &&
    match.majorStageRunId === null && match.managedKey === null && match.bracketNodeId === null);
  const executionCandidates = executionFacts ? sortAdminMatches(executionFacts.filter(match =>
    match.stage === executionStage && (!qualificationRun || executionStage !== "play-in" || isQualificationMatch(match)) &&
    (!filterStatus || filterStatus === "all" || match.status === filterStatus) &&
    (!filterTeam || filterTeam === "all" || match.entryAId === filterTeam || match.entryBId === filterTeam))) : [];
  const totalPages = Math.ceil(executionCandidates.length / 25);
  const parsedPage = Number(requestedPage);
  const page = totalPages ? Math.min(Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1, totalPages) : 1;
  const pageIds = executionCandidates.slice((page - 1) * 25, page * 25).map(match => match.id);
  const [allMatchesRaw, finalResult] = await Promise.all([
    view === "execution" && pageIds.length === 0 ? Promise.resolve([]) : db.query.matches.findMany({
      columns: { id: true, seasonId: true, entryAId: true, entryBId: true, stage: true, round: true,
        format: true, entryRound: true, scoreA: true, scoreB: true, status: true, isForfeit: true,
        ownership: true, majorStageRunId: true, qualificationRunId: true, managedKey: true,
        bracketNodeId: true, scheduledAt: true, completedAt: true, resultDisposition: true },
      where: view === "execution" ? and(scope, inArray(matches.id, pageIds)) : scope,
      orderBy: [asc(matches.createdAt), asc(matches.id)],
    }),
    isMajor && view === "schedule" ? db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) }) : Promise.resolve(undefined),
  ]);
  const allMatches = await withDisplayScores(allMatchesRaw.map(row => requireCompetitionMatch(row)));

  const { swissRuntime, playoffRuntime } = isMajor && view === "schedule"
    ? buildMajorRuntimeData({
        seasonId: season.id,
        stageRuns: stageRunRows,
        matches: allMatches,
        finalResultStatus: finalResult?.status,
      })
    : { swissRuntime: null, playoffRuntime: null };
  const defaultStageKey = executionStage ?? chooseStage(allMatches);
  const demoNeedsAttentionByMatch = view === "execution"
    ? await loadDemoNeedsAttentionCounts(allMatches.filter(match => (match.stage === defaultStageKey || !stageKeys.includes(match.stage))
      && (!filterStatus || filterStatus === "all" || match.status === filterStatus)
      && (!filterTeam || filterTeam === "all" || match.entryAId === filterTeam || match.entryBId === filterTeam))
      .map(match => match.id)) : new Map<string, number>();

  const statusFilter = (match: { status: string }) =>
    !filterStatus || filterStatus === "all" || match.status === filterStatus;
  const teamFilter = (match: { entryAId: string; entryBId: string }) =>
    !filterTeam || filterTeam === "all" || match.entryAId === filterTeam || match.entryBId === filterTeam;

  const qualificationMatches = qualificationRun
    ? allMatches.filter((match) => match.qualificationRunId === qualificationRun.id &&
      match.stage === "play-in" && match.ownership === "manual" && match.majorStageRunId === null &&
      match.managedKey === null && match.bracketNodeId === null)
    : [];
  const qualificationMatchIds = new Set(qualificationMatches.map((match) => match.id));
  const { views: allStageViews, unconfiguredMatches } = buildStageViews(
    stagePlan,
    allMatches.filter((match) => !qualificationMatchIds.has(match.id)),
  );
  const configuredStageViews = allStageViews.map(({ stage, matches: stageMatches }) => ({
    stage,
    matches: sortAdminMatches(
      stageMatches.filter(statusFilter).filter(teamFilter),
    ).map((match) => projectAdminMatchSummary(match, demoNeedsAttentionByMatch.get(match.id) ?? 0)),
  }));
  const qualificationStageView = qualificationRun ? {
    stage: {
      key: "play-in",
      name: "PLAY-IN",
      type: qualificationRun.format === "short_swiss_2w2l" ? "swiss" as const : "round_robin" as const,
      teamCount: qualificationRun.playInEntryCount,
      advanceTiers: [],
      matchFormat: qualificationRun.format === "direct_bo3" ? "bo3" as const : "bo1" as const,
    },
    matches: sortAdminMatches(qualificationMatches.filter(statusFilter).filter(teamFilter))
      .map((match) => projectAdminMatchSummary(match, demoNeedsAttentionByMatch.get(match.id) ?? 0)),
  } : null;
  const stageViews = [...(qualificationStageView ? [qualificationStageView] : []), ...configuredStageViews];
  const projectedMatches = allMatches.map((match) => projectAdminMatchSummary(match, demoNeedsAttentionByMatch.get(match.id) ?? 0));

  const roundRobinViews = allStageViews.filter((view) => view.stage.key === defaultStageKey && view.stage.type === "round_robin" && view.matches.length > 0);
  const finishedMatchIds = roundRobinViews.flatMap((view) => view.matches)
    .filter((match) => match.status === "finished")
    .map((match) => match.id);
  const [roundScoresByMatchId, stageEntrantIdsByKey] = view === "schedule" && roundRobinViews.length > 0
    ? await Promise.all([getMatchMapRoundScores(finishedMatchIds), loadStageBracketEntrantIds(db, season.id)])
    : [new Map(), new Map()];

  const standingsByStage = new Map(
    (view === "schedule" ? roundRobinViews : [])
      .filter((view) => view.stage.type === "round_robin" && view.matches.length > 0)
      .map((view) => [
        view.stage.key,
        calculateStageRoundRobinStandings({
          stage: view.stage,
          stageMatches: view.matches,
          entries: allTeams,
          roundScoresByMatchId,
          stageEntrantIds: stageEntrantIdsByKey.get(view.stage.key),
        }),
      ]),
  );
  const matchCount = stageCounts ? stageCounts.reduce((sum, row) => sum + Number(row.count), 0) : allMatches.length;
  const hasSwissStage = stagePlan.some((stage) => stage.type === "swiss");
  const canGenerate = season.status === "playing" && matchCount === 0 && allTeams.length >= 2 && !hasSwissStage;

  const scheduleRows = stageViews.find(stageView => stageView.stage.key === defaultStageKey)?.matches ?? [];
  const scheduleTotalPages = Math.ceil(scheduleRows.length / 25);
  const schedulePage = scheduleTotalPages ? Math.min(Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1, scheduleTotalPages) : 1;
  // Runtime/standings/batch groups above retain the whole frozen stage. Only
  // the ordinary rendered schedule list is paged.
  const renderedStageViews = view === "schedule" ? stageViews.map(stageView => ({ ...stageView,
    matches: stageView.stage.key === defaultStageKey ? stageView.matches.slice((schedulePage - 1) * 25, schedulePage * 25) : [],
  })) : stageViews;
  return {
    ...projectWorkspace(context),
    matches: projectedMatches,
    matchCount,
    stageViews: renderedStageViews,
    unconfiguredMatches: (executionFacts ? executionFacts.filter(match => !configuredKeys.includes(match.stage ?? "") && !isQualificationMatch(match)) : unconfiguredMatches)
      .map(match => ({ id: match.id, stage: match.stage ?? "" })),
    pagination: view === "execution" ? { total: executionCandidates.length, page, pageSize: 25, totalPages }
      : { total: scheduleRows.length, page: schedulePage, pageSize: 25, totalPages: scheduleTotalPages },
    standingsByStage,
    batchDeadlineGroups: view === "schedule" ? buildBatchDeadlineGroups(allMatches, stagePlan) : [],
    canGenerate,
    hasSwissStage,
    defaultStageKey,
    swissRuntime,
    playoffRuntime,
  };
}
