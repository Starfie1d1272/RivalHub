import { assertCompetitionMatch } from "./competition-context";
import "server-only";
import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { seasons, matches } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { advanceStageBracket, ensureResolvedBracketMatch, loadStageBracketState, saveStageBracketState, type ResolvedBracketMatch } from "@/lib/bracket";
import { resolveMatchFormat } from "@/lib/match-transitions";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { persistCompletedMatchInTx } from "./completion";
import { maybeFinishSeason } from "@/lib/seasons/transitions";
import { completeCompetitionQualificationIfReadyInTx } from "@/lib/competition-qualification/runtime";

/** Persist provider-resolved nodes through the fail-closed bracket boundary. */
async function insertResolvedBracketMatches(
  tx: TxDb,
  seasonId: string,
  stageKey: string,
  resolvedMatches: ResolvedBracketMatch[],
  stagePlan: ReturnType<typeof normalizeStagePlan>,
) {
  for (const resolved of resolvedMatches) {
    await ensureResolvedBracketMatch(tx, {
      seasonId,
      stageKey,
      resolved,
      format: resolveMatchFormat(stagePlan, stageKey, resolved.roundNumber, resolved.groupNumber),
    });
  }
}


/** Complete a validated series through the same lifecycle/progression owner.
 * Major stages keep their explicit round-finalization gate. */
export async function finishCompetitionSeriesInTx(tx: TxDb, input: {
  match: typeof matches.$inferSelect; scoreA: number; scoreB: number;
  completedAt: Date; preserveMapPlans?: boolean;
}) {
  const locked = input.match;
  assertCompetitionMatch(locked);
  const [lockedSeason] = await tx.select().from(seasons).where(eq(seasons.id, locked.seasonId)).for("update");
  if (!lockedSeason) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const bracketState = locked.bracketNodeId ? await loadStageBracketState(tx, locked.seasonId, locked.stage) : null;
  await persistCompletedMatchInTx(tx, input);
  if (locked.qualificationRunId) await completeCompetitionQualificationIfReadyInTx(tx, locked.qualificationRunId);
  if (bracketState && locked.bracketNodeId) {
    const { updatedData, newResolvedMatches } = await advanceStageBracket(locked.stage, locked.bracketNodeId, { scoreA: input.scoreA, scoreB: input.scoreB }, bracketState);
    await saveStageBracketState(tx, locked.seasonId, locked.stage, updatedData);
    await insertResolvedBracketMatches(tx, locked.seasonId, locked.stage, newResolvedMatches, normalizeStagePlan(lockedSeason.stagePlan));
  }
  return maybeFinishSeason(tx, locked.seasonId);
}

