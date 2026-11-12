"use server";

import { db } from "@/db/client";
import { ok } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { getMatchOrThrow, actionError } from "@/lib/action-utils";
import { deliverMatchProjectionInvalidations } from "@/lib/matches/projection-invalidation/delivery";
import {
  applyResultCorrectionInTx,
  planResultCorrectionInTx,
  recordRecoveryAdjudicationInTx,
} from "@/lib/match-corrections/service";
import {
  presentResultCorrectionPlan,
  type ResultCorrectionPlanPresentation,
} from "@/lib/match-corrections/presentation";

/**
 * G2 result-correction workflow: plan → review impact → explicit confirm.
 * Server Actions stay thin wrappers around the transactional service so the
 * local PostgreSQL suite exercises the exact production logic.
 */

export async function planMatchResultCorrection(
  matchId: string,
  proposal: { scoreA: number; scoreB: number; isForfeit?: boolean },
): Promise<ActionResult<ResultCorrectionPlanPresentation>> {
  try {
    const match = await getMatchOrThrow(matchId);
    await requireSeasonAdmin(match.seasonId);
    const plan = await db.transaction((tx) => planResultCorrectionInTx(tx, { matchId, proposal }));
    return ok(presentResultCorrectionPlan(plan));
  } catch (e) {
    return actionError("planMatchResultCorrection", e);
  }
}

export async function applyMatchResultCorrection(
  matchId: string,
  input: {
    scoreA: number;
    scoreB: number;
    isForfeit?: boolean;
    /** Must be true when the correction changes the winner. */
    confirmRecovery?: boolean;
  },
): Promise<
  ActionResult<{
    alreadyApplied: boolean;
    winnerChanged: boolean;
    invalidatedCount: number;
    rolledBackToFinalized: number | null;
  }>
> {
  try {
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);

    const applied = await db.transaction((tx) =>
      applyResultCorrectionInTx(tx, {
        matchId,
        proposal: {
          scoreA: input.scoreA,
          scoreB: input.scoreB,
          isForfeit: input.isForfeit,
        },
        actorId: auditActorId(admin),
        confirmRecovery: input.confirmRecovery === true,
      }),
    );

    await deliverMatchProjectionInvalidations("action", [matchId]);

    return ok({
      alreadyApplied: applied.alreadyApplied,
      winnerChanged: applied.winnerChanged,
      invalidatedCount: applied.invalidatedDownstreamMatches.length,
      rolledBackToFinalized: applied.rolledBackToFinalized,
    });
  } catch (e) {
    return actionError("applyMatchResultCorrection", e);
  }
}

export async function recordMatchRecoveryAdjudication(
  matchId: string,
  note: string,
): Promise<ActionResult<{ recorded: true }>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    const result = await db.transaction((tx) =>
      recordRecoveryAdjudicationInTx(tx, { matchId, actorId: auditActorId(admin), note }),
    );
    return ok(result);
  } catch (e) {
    return actionError("recordMatchRecoveryAdjudication", e);
  }
}
