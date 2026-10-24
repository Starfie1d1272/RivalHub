import "server-only";
import { assertCompetitionMatch } from "./competition-context";
import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, type Match } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertSeasonAllowsTournamentMutationInTx, lockSeasonForTournamentInTx } from "@/lib/postevent/guard";

/** Discover scope without a row lock, then lock season before its match.
 * Recheck the association under lock so discovery cannot authorize a new scope.
 * All callers must enter before locking match children or financial programs.
 */
async function lockScopedMatchInTx(tx: TxDb, matchId: string, inspection: boolean, strength: "update" | "share" = "update"): Promise<Match> {
  const [scope] = await tx.select({ seasonId: matches.seasonId }).from(matches).where(eq(matches.id, matchId));
  if (!scope) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
  if (scope.seasonId) {
    if (inspection) await lockSeasonForTournamentInTx(tx, scope.seasonId);
    else await assertSeasonAllowsTournamentMutationInTx(tx, scope.seasonId);
  }
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for(strength);
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
  if (match.seasonId !== scope.seasonId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛所属赛事已变化，请重新读取后再操作。");
  }
  return match;
}

export function lockMatchInTx(tx: TxDb, matchId: string): Promise<Match> {
  return lockScopedMatchInTx(tx, matchId, false);
}

/** Explicit post-event inspection/adjudication channel; retains archive access. */
export function lockMatchForInspectionInTx(tx: TxDb, matchId: string): Promise<Match> {
  return lockScopedMatchInTx(tx, matchId, true);
}

/** Evidence/vote writers keep their existing match SHARE and post-event access.
 * Acquire before map/stat rows; the event UPDATE fence must never be upgraded.
 */
export function lockMatchForEvidenceInTx(tx: TxDb, matchId: string): Promise<Match> {
  return lockScopedMatchInTx(tx, matchId, true, "share");
}

/** Existing competition workflows require event association in addition to the shared lock. */
export async function lockCompetitionMatchInTx(tx: TxDb, matchId: string) {
  const match = await lockMatchInTx(tx, matchId);
  assertCompetitionMatch(match);
  return match;
}
