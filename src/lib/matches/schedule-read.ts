import "server-only";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, type Match } from "@/db/schema";

export type PublicScheduleMatch = Omit<Match, "videoUrl" | "recordings" | "mvpWinnerUserId" | "createdAt" | "updatedAt" |
  "executionContext" | "testConfig" | "entryRound" | "gameplayStartedAt" | "completionDeadline">;
import { officialMatchCondition } from "./scope";

/** Preserve the global mismatch warning without loading every historical match. */
export async function hasUnconfiguredPublicScheduleMatches(seasonId: string, stageKeys: readonly string[], qualificationRunId?: string) {
  const qualificationScope = qualificationRunId ? and(
    eq(matches.qualificationRunId, qualificationRunId), eq(matches.stage, "play-in"),
    eq(matches.ownership, "manual"), isNull(matches.majorStageRunId), isNull(matches.managedKey), isNull(matches.bracketNodeId),
  ) : null;
  const [row] = await db.select({ id: matches.id }).from(matches).where(and(
    officialMatchCondition(), eq(matches.seasonId, seasonId),
    stageKeys.length ? notInArray(matches.stage, [...stageKeys]) : undefined,
    qualificationScope ? sql`(${qualificationScope}) is not true` : undefined,
  )).limit(1);
  return row !== undefined;
}
