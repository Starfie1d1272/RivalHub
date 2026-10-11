import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import "server-only";

import { fail } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { captureException } from "@/lib/observability/server";
import { ensureRequestId } from "@/lib/observability/context";
import { classifyError } from "@/lib/observability/errors";
import { PasswordMutationError, passwordFailureCause, passwordFailureStatus } from "@/lib/auth/password-error";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches } from "@/db/schema";
export { isPgUniqueViolation } from "@/db/errors";

// ── Error handling ──

export function failValidation(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

export function actionError(scope: string, e: unknown, phase = "action"): ActionResult<never> {
  if (e instanceof PasswordMutationError) {
    const requestId = ensureRequestId();
    captureException("auth.password_update.failure", {
      name: "PasswordMutationError", code: e.code, cause: passwordFailureCause(e.cause),
    }, {
      scope: e.outcome === "finalization_unknown" ? "database" : "provider", operation: scope, errorClass: e.outcome === "finalization_unknown" ? "database" : e.outcome === "unknown" ? "dependency" : "expected", errorCode: e.code,
      retryable: e.outcome === "rejected", requestId,
      safeContext: { provider: "supabase-auth", outcome: e.outcome, stage: e.providerOutcome, phase: e.outcome === "finalization_unknown" ? "finalize" : phase, httpStatus: passwordFailureStatus(e.cause) },
    });
    return fail({ code: e.code, requestId, message: `${e.message}排查编号：${requestId}` });
  }
  if (e instanceof AppError) {
    if (e.code === ErrorCode.INTERNAL_ERROR) {
      const requestId = ensureRequestId();
      captureException("action.internal_error", e, {
        scope: "action",
        operation: scope,
        errorClass: "application",
        errorCode: e.code,
        requestId,
        safeContext: { phase },
      });
      return fail({ code: e.code, requestId, message: internalErrorMessage(requestId) });
    }
    return fail({ code: e.code, message: e.presentation?.message ?? e.message });
  }
  const requestId = ensureRequestId();
  captureException("action.unexpected_error", e, { scope: "action", operation: scope, requestId, errorCode: classifyError(e).errorCode ?? ErrorCode.INTERNAL_ERROR, safeContext: { phase } });
  return fail({ code: ErrorCode.INTERNAL_ERROR, requestId, message: internalErrorMessage(requestId) });
}

function internalErrorMessage(requestId: string): string {
  return `${ERROR_MESSAGES.INTERNAL_ERROR}。请先刷新确认操作结果；如仍有问题，请向管理员提供排查编号：${requestId}`;
}

// ── DB query helpers ──

export async function getSeasonOrThrow(seasonId: string) {
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, seasonId) });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
  return season;
}

export async function getMatchOrThrow(matchId: string) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, ERROR_MESSAGES.MATCH_NOT_FOUND);
  assertCompetitionMatch(match);
  return match;
}
