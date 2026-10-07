import "server-only";
import type { TxDb } from "@/db/client";
import type { Match } from "@/db/schema";
import { assertCompetitionMatch } from "./competition-context";
import { AppError, ErrorCode } from "@/lib/errors";
import { materializeDefaultLineupsInTx, freezeEffectiveLineupsForStartInTx } from "@/lib/match-rosters/service";

/** Competition participation policy; roster completeness is not a CS lifecycle invariant. */
export async function prepareCompetitionMatchTransitionInTx(
  tx: TxDb, match: Match, nextStatus: "in_progress" | "cancelled", now: Date, actorId: string,
) {
  if (!match.seasonId) return null;
  assertCompetitionMatch(match);
  if (match.qualificationRunId && nextStatus === "cancelled") {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "Play-in 比赛不能取消，请使用弃赛判负录入正式赛果。");
  }
  if (nextStatus !== "in_progress") return null;
  await materializeDefaultLineupsInTx(tx, match, now, true);
  return freezeEffectiveLineupsForStartInTx(tx, match, now, actorId);
}
