"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { ok } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { getMatchOrThrow, actionError } from "@/lib/action-utils";
import { revalidateMatchPaths, revalidateSeasonPaths } from "@/lib/revalidation";
import {
  applyResultCorrectionInTx,
  planResultCorrectionInTx,
  recordRecoveryAdjudicationInTx,
} from "@/lib/match-corrections/service";
import { traceOperation } from "@/lib/observability/tracing";

/**
 * G2 result-correction workflow: plan → review impact → explicit confirm.
 * Server Actions stay thin wrappers around the transactional service so the
 * local PostgreSQL suite exercises the exact production logic.
 */

export async function planMatchResultCorrection(
  matchId: string,
  proposal: { scoreA: number; scoreB: number; isForfeit?: boolean },
): Promise<ActionResult<unknown>> {
  try {
    const match = await getMatchOrThrow(matchId);
    await requireSeasonAdmin(match.seasonId);
    const plan = await traceOperation("match.result_correction.plan", {
      scope: "match",
      operation: "result_correction.plan",
      attributes: { "rivalhub.workflow": "match_recovery" },
    }, () => db.transaction((tx) =>
      planResultCorrectionInTx(tx, { matchId, proposal }),
    ));
    return ok(plan);
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
): Promise<ActionResult<{
  alreadyApplied: boolean;
  winnerChanged: boolean;
  invalidatedCount: number;
  rolledBackToFinalized: number | null;
}>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);

    const applied = await traceOperation("match.result_correction.apply", {
      scope: "match",
      operation: "result_correction.apply",
      attributes: { "rivalhub.workflow": "match_recovery" },
    }, () => db.transaction((tx) =>
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
    ));

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
      columns: { slug: true },
    });
    if (season) {
      revalidateMatchPaths(season.slug, matchId);
      revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);
    }

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
    const result = await traceOperation("match.result_correction.adjudicate", {
      scope: "match",
      operation: "result_correction.adjudicate",
      attributes: { "rivalhub.workflow": "match_recovery" },
    }, () => db.transaction((tx) =>
      recordRecoveryAdjudicationInTx(tx, { matchId, actorId: auditActorId(admin), note }),
    ));
    return ok(result);
  } catch (e) {
    return actionError("recordMatchRecoveryAdjudication", e);
  }
}
