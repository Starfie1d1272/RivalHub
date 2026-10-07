import "server-only";
import { assertCompetitionMatch } from "./competition-context";
import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, type Match } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";

/** Existing event mutation boundary; the match lock and event policy are both mandatory. */
export async function lockMatchInTx(tx: TxDb, matchId: string): Promise<Match> {
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
  if (match.seasonId) await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
  return match;
}

/** Existing competition workflows require event association in addition to the shared lock. */
export async function lockCompetitionMatchInTx(tx: TxDb, matchId: string) {
  const match = await lockMatchInTx(tx, matchId);
  assertCompetitionMatch(match);
  return match;
}
