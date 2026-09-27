import { eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import type { Match } from "@/db/schema";
import {
  matchCommentators,
  matchMaps,
  matchRosterPlayers,
  matchRosters,
  matchTimeProposals,
  matchVetoSteps,
  matches,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

export function assertGenericMatchCanBeDeleted(match: Pick<Match, "qualificationRunId">): void {
  if (match.qualificationRunId) {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "资格赛生成的比赛不能单独删除。");
  }
}

/** Remove a scheduled match and its replaceable pre-match facts in one transaction. */
export async function deleteScheduledMatchAndDependentsInTx(tx: TxDb, matchId: string): Promise<{ id: string }> {
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
  if (match.status !== "scheduled") {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有尚未开始的比赛可以从赛程中作废。");
  }

  await tx.delete(matchTimeProposals).where(eq(matchTimeProposals.matchId, matchId));
  await tx.delete(matchCommentators).where(eq(matchCommentators.matchId, matchId));
  await tx.delete(matchVetoSteps).where(eq(matchVetoSteps.matchId, matchId));
  await tx.delete(matchMaps).where(eq(matchMaps.matchId, matchId));
  const rosterIds = await tx.select({ id: matchRosters.id }).from(matchRosters).where(eq(matchRosters.matchId, matchId));
  if (rosterIds.length > 0) {
    await tx.delete(matchRosterPlayers).where(inArray(matchRosterPlayers.rosterId, rosterIds.map((roster) => roster.id)));
  }
  await tx.delete(matchRosters).where(eq(matchRosters.matchId, matchId));
  const [deleted] = await tx.delete(matches).where(eq(matches.id, matchId)).returning({ id: matches.id });
  if (!deleted) throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛状态已变化，不能作废该场比赛。");
  return deleted;
}
