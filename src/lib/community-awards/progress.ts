import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { competitionQualificationRuns, majorFinalResults, majorStageRuns, seasons } from "@/db/schema";
import { parseMajorRunSnapshot, resolveMajorStagePlan } from "@/lib/major/run-snapshot";

/** Read authoritative completion facts, never the currently materialized match subset. */
export async function getCommunityAwardProgress(executor: Pick<DB, "select">, seasonId: string) {
  const [season] = await executor.select({ status: seasons.status, template: seasons.competitionTemplate, stagePlan: seasons.stagePlan }).from(seasons).where(eq(seasons.id, seasonId));
  const [qualification] = await executor.select({ completedAt: competitionQualificationRuns.completedAt }).from(competitionQualificationRuns).where(eq(competitionQualificationRuns.seasonId, seasonId));
  const runs = await executor.select().from(majorStageRuns).where(eq(majorStageRuns.seasonId, seasonId));
  const [final] = await executor.select({ runId: majorFinalResults.playoffStageRunId, status: majorFinalResults.status }).from(majorFinalResults).where(eq(majorFinalResults.seasonId, seasonId));
  return {
    stages: (season?.template === "major" ? resolveMajorStagePlan(season.stagePlan, runs) : []).map(stage => ({ key: stage.key, name: stage.name })),
    seasonComplete: season?.template === "major" ? final?.status === "confirmed" : season?.status === "finished" || season?.status === "archived",
    playInComplete: !!qualification?.completedAt,
    completedStageKeys: runs.filter(run => {
      const snapshot = parseMajorRunSnapshot(run.ruleSnapshot, run.stageKey);
      return snapshot.stage.key === run.stageKey && (snapshot.stage.type === "swiss" ? run.finalizedRound === 5 : snapshot.stage.type === "single_elim" && final?.runId === run.id);
    }).map(run => run.stageKey),
  };
}
