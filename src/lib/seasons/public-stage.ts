import { loadOfficialMatchStages } from "@/lib/matches/read-official";
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionQualificationRuns, majorStageRuns, matches } from "@/db/schema";
import { buildOfficialStageDirectory, type OfficialStage, type QualificationStageFact } from "./official-stages";
import { resolveMajorStagePlan } from "@/lib/major/run-snapshot";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { presentStageMarker } from "@/lib/seasons/presentation";
import type { PublicSeason } from "@/lib/data/public-seasons";
import type { StagePlan } from "@/types/season";

export type PublicStageSeason = Pick<PublicSeason, "id" | "competitionTemplate" | "stagePlan">;

export interface PublicStagePresentation {
  stagePlan: StagePlan;
  officialStages: OfficialStage[];
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
  stageRuns: readonly { stageKey: string; ruleSnapshot: unknown; startedAt?: Date }[] = [],
): StagePlan {
  return season.competitionTemplate === "major"
    ? resolveMajorStagePlan(normalizeStagePlan(season.stagePlan), stageRuns)
    : normalizeStagePlan(season.stagePlan);
}

export function buildPublicStagePresentation(
  season: PublicStageSeason,
  stageRuns: readonly { stageKey: string; ruleSnapshot: unknown; startedAt?: Date }[] = [],
  initializedStageKeys: readonly string[] = [],
  qualification: QualificationStageFact | null = null,
): PublicStagePresentation {
  const stagePlan = resolvePublicStagePlan(season, stageRuns);
  const officialStages = buildOfficialStageDirectory(stagePlan, qualification, initializedStageKeys, normalizeStagePlan(season.stagePlan));
  const initialized = new Set(initializedStageKeys);
  const runKeys = new Set(stageRuns.map((run) => run.stageKey));
  const latestRun = [...stageRuns].filter((run) => run.startedAt).sort((a, b) => b.startedAt!.getTime() - a.startedAt!.getTime())[0];
  const currentStage = (latestRun ? stagePlan.find((stage) => stage.key === latestRun.stageKey) : null) ?? [...stagePlan].reverse().find((stage) =>
    season.competitionTemplate === "major" && runKeys.size > 0
      ? runKeys.has(stage.key)
      : initialized.has(stage.key),
  ) ?? null;
  return {
    stagePlan,
    officialStages,
    labels: Object.fromEntries(
      officialStages.map((stage) => [stage.key, stage.config ? presentStageMarker(stage.config, season.competitionTemplate) : stage.name]),
    ),
    initializedStageKeys: [...initializedStageKeys],
    currentStageKey: currentStage?.key ?? (qualification?.startedAt || initialized.has("play-in") ? "play-in" : null),
    currentStageLabel: currentStage ? presentStageMarker(currentStage, season.competitionTemplate) : qualification?.startedAt || initialized.has("play-in") ? "Play-in" : null,
  };
}

export async function getPublicSeasonStagePresentation(
  season: PublicStageSeason,
): Promise<PublicStagePresentation> {
  const [stageRuns, matchStageRows, qualificationRows] = await Promise.all([
    season.competitionTemplate === "major"
      ? db
        .select({ stageKey: majorStageRuns.stageKey, ruleSnapshot: majorStageRuns.ruleSnapshot, startedAt: majorStageRuns.startedAt })
        .from(majorStageRuns)
        .where(eq(majorStageRuns.seasonId, season.id))
      : Promise.resolve([] as { stageKey: string; ruleSnapshot: unknown }[]),
    loadOfficialMatchStages(eq(matches.seasonId, season.id)),
    db.select({ format: competitionQualificationRuns.format, playInEntryCount: competitionQualificationRuns.playInEntryCount,
      qualifierCount: competitionQualificationRuns.qualifierCount, startedAt: competitionQualificationRuns.startedAt,
      completedAt: competitionQualificationRuns.completedAt }).from(competitionQualificationRuns)
      .where(eq(competitionQualificationRuns.seasonId, season.id)).limit(1),
  ]);

  return buildPublicStagePresentation(
    season,
    stageRuns,
    matchStageRows.flatMap((row) => row.stage === null ? [] : [row.stage]),
    qualificationRows[0] ?? null,
  );
}
