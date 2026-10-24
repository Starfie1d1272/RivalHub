import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { matches } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertCompetitionMatch } from "./competition-context";

/** Scope discovery contains no recordings, private lineup or proposal response. */
export async function getReadbackMatchOrThrow(matchId: string) {
  if (!z.uuid().safeParse(matchId).success) throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛编号无效。");
  const [match] = await db.select({ id: matches.id, seasonId: matches.seasonId, entryAId: matches.entryAId, entryBId: matches.entryBId, stage: matches.stage })
    .from(matches).where(eq(matches.id, matchId));
  if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
  assertCompetitionMatch(match);
  return match;
}
