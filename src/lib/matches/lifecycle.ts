import "server-only";
import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, matchCommentators, type Match } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { transitionMatchExecution } from "./execution";
import { lockMatchInTx } from "./locking";
import { prepareCompetitionMatchTransitionInTx } from "./competition-policy";
import type { StartLineupSummary } from "@/lib/match-rosters/service";

export interface MatchTransitionOutcome {
  from: Match["status"];
  to: "in_progress" | "cancelled";
  lineups: StartLineupSummary[] | null;
}

/**
 * The complete production body of a match status transition, shared by the
 * Server Action wrapper and the local integration suite:
 * row-lock → state machine → optional competition policy → status write → audit.
 */
export async function applyMatchStatusTransitionInTx(
  tx: TxDb,
  args: {
    matchId: string;
    nextStatus: "in_progress" | "cancelled";
    actorId: string;
    expectedStatus?: Match["status"];
    now?: Date;
  },
): Promise<MatchTransitionOutcome> {
  const locked = await lockMatchInTx(tx, args.matchId);
  if (args.expectedStatus && locked.status !== args.expectedStatus) {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛状态已变化，请刷新后核对。");
  }
  const now = args.now ?? new Date();
  const patch = transitionMatchExecution(locked, args.nextStatus, now);
  const lineups = await prepareCompetitionMatchTransitionInTx(
    tx,
    locked,
    args.nextStatus,
    now,
    args.actorId,
  );
  const clearedCommentators =
    args.nextStatus === "cancelled"
      ? await tx
          .delete(matchCommentators)
          .where(eq(matchCommentators.matchId, locked.id))
          .returning({ userId: matchCommentators.userId })
      : [];

  await tx.update(matches).set(patch).where(eq(matches.id, args.matchId));

  await writeAuditInTx(tx, {
    seasonId: locked.seasonId,
    action: args.nextStatus === "in_progress" ? "match.start" : "match.status_update",
    actorId: args.actorId,
    targetId: args.matchId,
    meta: {
      from: locked.status,
      to: args.nextStatus,
      ...(lineups
        ? {
            lineups: lineups.map((summary) => ({
              entryId: summary.entryId,
              rosterId: summary.rosterId,
              starterIds: summary.starterIds,
              substituteIds: summary.substituteIds,
            })),
          }
        : {}),
      ...(clearedCommentators.length > 0
        ? {
            clearedCommentatorUserIds: clearedCommentators.map((commentator) => commentator.userId),
          }
        : {}),
    },
  });

  return { from: locked.status, to: args.nextStatus, lineups };
}
