"use server";

import type {
  MatchWorkspaceModel,
  SeasonCohortBundle,
  SeasonLeaderboardModel,
} from "@cs2dak/contract";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { demoAnalysisRuns, demoImports, seasonAnalysisRuns } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { ok, type ActionResult } from "@/types/action";

export async function getCurrentMatchWorkspace(
  mapId: string,
): Promise<ActionResult<MatchWorkspaceModel | null>> {
  try {
    const [row] = await db
      .select({ workspace: demoAnalysisRuns.workspaceModel })
      .from(demoImports)
      .innerJoin(demoAnalysisRuns, eq(demoAnalysisRuns.importId, demoImports.id))
      .where(and(
        eq(demoImports.mapId, mapId),
        eq(demoImports.isCurrent, true),
        eq(demoAnalysisRuns.status, "ready"),
      ))
      .orderBy(desc(demoAnalysisRuns.completedAt))
      .limit(1);

    return ok(row?.workspace ?? null);
  } catch (error) {
    return actionError("getCurrentMatchWorkspace", error);
  }
}

export async function getCurrentSeasonAnalysis(
  seasonId: string,
): Promise<ActionResult<{
  cohort: SeasonCohortBundle;
  leaderboard: SeasonLeaderboardModel;
  weightsVersion: string | null;
  completedAt: Date | null;
} | null>> {
  try {
    const [row] = await db
      .select({
        cohort: seasonAnalysisRuns.cohortBundle,
        leaderboard: seasonAnalysisRuns.leaderboardModel,
        weightsVersion: seasonAnalysisRuns.ratingVersion,
        completedAt: seasonAnalysisRuns.completedAt,
      })
      .from(seasonAnalysisRuns)
      .where(and(
        eq(seasonAnalysisRuns.seasonId, seasonId),
        eq(seasonAnalysisRuns.status, "ready"),
      ))
      .orderBy(desc(seasonAnalysisRuns.completedAt))
      .limit(1);

    if (!row?.cohort || !row.leaderboard) return ok(null);
    return ok({
      cohort: row.cohort,
      leaderboard: row.leaderboard,
      weightsVersion: row.weightsVersion,
      completedAt: row.completedAt,
    });
  } catch (error) {
    return actionError("getCurrentSeasonAnalysis", error);
  }
}
