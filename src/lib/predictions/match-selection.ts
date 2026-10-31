import { matches } from "@/db/schema";

/** Complete baseline match facts, excluding fields used only by other views. */
export const predictionMatchSelection = {
  id: matches.id, seasonId: matches.seasonId, entryAId: matches.entryAId, entryBId: matches.entryBId,
  executionContext: matches.executionContext, resultDisposition: matches.resultDisposition, testConfig: matches.testConfig,
  stage: matches.stage, round: matches.round, format: matches.format, entryRound: matches.entryRound,
  scoreA: matches.scoreA, scoreB: matches.scoreB, status: matches.status, isForfeit: matches.isForfeit,
  bracketNodeId: matches.bracketNodeId, ownership: matches.ownership, majorStageRunId: matches.majorStageRunId,
  qualificationRunId: matches.qualificationRunId, managedKey: matches.managedKey,
  gameplayStartedAt: matches.gameplayStartedAt, startedAt: matches.startedAt, scheduledAt: matches.scheduledAt,
  completionDeadline: matches.completionDeadline, completedAt: matches.completedAt,
};

export type PredictionMatch = Omit<typeof matches.$inferSelect, "videoUrl" | "recordings" | "mvpWinnerUserId" | "createdAt" | "updatedAt">;
