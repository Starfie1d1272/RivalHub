import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, majorFinalResults, majorStageRuns, matches, seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getMatchMapRoundScores } from "@/lib/data/standings";
import { calculateStandings } from "@/lib/standings";
import {
  buildStageViews,
  getTeamsReferencedByMatches,
  hasAdjacentLegacyQualifierPlayoff,
  resolveDefaultStageKey,
} from "@/lib/matches/stage-views";
import { getFirstStageOfType, normalizeRegistrationConfig, normalizeStagePlan } from "@/types/season";
import { buildMajorRuntimeData } from "@/lib/admin/major-runtime";
import type { AdminMatchOverviewData } from "@/lib/admin/matches/types";
import { buildBatchDeadlineGroups, projectAdminMatchSummary, sortAdminMatches } from "@/lib/admin/matches/shared";

export interface AdminMatchOverviewFilter {
  seasonSlug: string;
  stage?: string;
  status?: string;
  team?: string;
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

  const [allTeams, allMatches, stageRunRows, finalResult] = await Promise.all([
    db.query.competitionEntries.findMany({
      where: eq(competitionEntries.competitionId, season.id),
      orderBy: [asc(competitionEntries.formationOrder)],
    }),
    db.query.matches.findMany({
      where: eq(matches.seasonId, season.id),
      orderBy: [asc(matches.createdAt)],
    }),
    db
      .select({ id: majorStageRuns.id, stageKey: majorStageRuns.stageKey, finalizedRound: majorStageRuns.finalizedRound })
      .from(majorStageRuns)
      .where(eq(majorStageRuns.seasonId, season.id)),
    db.query.majorFinalResults.findFirst({ where: eq(majorFinalResults.seasonId, season.id) }),
  ]);

  const stagePlan = normalizeStagePlan(season.stagePlan);
  const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
  const { swissRuntime, playoffRuntime } = buildMajorRuntimeData({
    seasonId: season.id,
    stagePlan,
    stageRuns: stageRunRows,
    matches: allMatches,
    finalResultStatus: finalResult?.status,
  });

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

  const finishedMatchIds = allMatches
    .filter((match) => match.status === "finished")
    .map((match) => match.id);
  const roundScoresByMatchId = await getMatchMapRoundScores(finishedMatchIds);

  const qualifierStage = getFirstStageOfType(stagePlan, ["round_robin", "swiss"]);
  const playoffStage = getFirstStageOfType(stagePlan, ["double_elim", "single_elim"]);
  const standingsByStage = new Map(
    allStageViews
      .filter((view) => view.stage.type === "round_robin" && view.matches.length > 0)
      .map((view) => [
        view.stage.key,
        calculateStandings(
          getTeamsReferencedByMatches(allTeams, view.matches),
          view.matches.filter((match) => match.status === "finished"),
          roundScoresByMatchId,
        ),
      ]),
  );
  const qualifierStandings = qualifierStage ? standingsByStage.get(qualifierStage.key) ?? [] : [];

  const qualifierView = qualifierStage
    ? allStageViews.find((view) => view.stage.key === qualifierStage.key)
    : null;
  const playoffView = playoffStage
    ? allStageViews.find((view) => view.stage.key === playoffStage.key)
    : null;
  const hasTerminalLegacyQualifierMatches =
    qualifierView != null &&
    qualifierView.matches.length > 0 &&
    qualifierView.matches.every((match) => match.status === "finished" || match.status === "cancelled");
  const canGeneratePlayoff =
    !!qualifierStage &&
    !!playoffStage &&
    hasAdjacentLegacyQualifierPlayoff(stagePlan) &&
    hasTerminalLegacyQualifierMatches &&
    playoffView?.matches.length === 0;
  const hasLegacyAdjacentPlayoff = hasAdjacentLegacyQualifierPlayoff(stagePlan);

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
    mapPool,
    matches: projectedMatches,
    stageViews,
    unconfiguredMatches: unconfiguredMatches.map(projectAdminMatchSummary),
    standingsByStage,
    qualifierStandings,
    qualifierStage,
    playoffStage,
    batchDeadlineGroups: buildBatchDeadlineGroups(allMatches, stagePlan),
    canGenerate,
    canGeneratePlayoff,
    hasLegacyAdjacentPlayoff,
    hasSwissStage,
    defaultStageKey: resolveDefaultStageKey(stagePlan, allMatches, filterStage),
    swissRuntime,
    playoffRuntime,
  };
}
