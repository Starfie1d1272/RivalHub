import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { majorStageRuns, matches } from "@/db/schema";
import { resolveMajorStagePlan } from "@/lib/major/run-snapshot";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { presentStageMarker } from "@/lib/seasons/presentation";
import type { PublicSeason } from "@/lib/data/public-seasons";
import type { StagePlan } from "@/types/season";

export type PublicStageSeason = Pick<PublicSeason, "id" | "competitionTemplate" | "stagePlan">;

export interface PublicStagePresentation {
  stagePlan: StagePlan;
  labels: Readonly<Record<string, string>>;
  initializedStageKeys: readonly string[];
  currentStageKey: string | null;
  currentStageLabel: string | null;
}

/** The public Stage plan is the event plan, or the frozen Major StageRun plan
 * once the tournament has started. Season lifecycle status never substitutes
 * for a Stage identity. */
export function resolvePublicStagePlan(
  season: PublicStageSeason,
  stageRuns: readonly { stageKey: string; ruleSnapshot: unknown }[] = [],
): StagePlan {
  return season.competitionTemplate === "major"
    ? resolveMajorStagePlan(normalizeStagePlan(season.stagePlan), stageRuns)
    : normalizeStagePlan(season.stagePlan);
}

export function buildPublicStagePresentation(
  season: PublicStageSeason,
  stageRuns: readonly { stageKey: string; ruleSnapshot: unknown }[] = [],
  initializedStageKeys: readonly string[] = [],
): PublicStagePresentation {
  const stagePlan = resolvePublicStagePlan(season, stageRuns);
  const initialized = new Set(initializedStageKeys);
  const currentStage = [...stagePlan].reverse().find((stage) => initialized.has(stage.key)) ?? null;
  return {
    stagePlan,
    labels: Object.fromEntries(
      stagePlan.map((stage) => [stage.key, presentStageMarker(stage, season.competitionTemplate)]),
    ),
    initializedStageKeys: [...initializedStageKeys],
    currentStageKey: currentStage?.key ?? null,
    currentStageLabel: currentStage ? presentStageMarker(currentStage, season.competitionTemplate) : null,
  };
}

export async function getPublicSeasonStagePresentation(
  season: PublicStageSeason,
): Promise<PublicStagePresentation> {
  // Some lightweight public route callers (and their contract tests) only
  // need the participant projection. A missing legacy stage plan means there
  // is no public Stage fact to resolve, so avoid opening a database connection.
  if (!season.stagePlan) return buildPublicStagePresentation(season, [], []);

  const [stageRuns, matchStageRows] = await Promise.all([
    season.competitionTemplate === "major"
      ? db
        .select({ stageKey: majorStageRuns.stageKey, ruleSnapshot: majorStageRuns.ruleSnapshot })
        .from(majorStageRuns)
        .where(eq(majorStageRuns.seasonId, season.id))
      : Promise.resolve([] as { stageKey: string; ruleSnapshot: unknown }[]),
    db
      .selectDistinct({ stage: matches.stage })
      .from(matches)
      .where(eq(matches.seasonId, season.id)),
  ]);

  return buildPublicStagePresentation(
    season,
    stageRuns,
    matchStageRows.map((row) => row.stage),
  );
}
