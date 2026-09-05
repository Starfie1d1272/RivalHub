import "server-only";

import { fail } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { captureException } from "@/lib/observability/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches } from "@/db/schema";
export { isPgUniqueViolation } from "@/db/errors";

// ── Error handling ──

export function failValidation(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

export function actionError(scope: string, e: unknown): ActionResult<never> {
  if (e instanceof AppError) {
    if (e.code === ErrorCode.INTERNAL_ERROR) {
      captureException("action.internal_error", e, {
        scope: "action",
        operation: scope,
        errorClass: "application",
        errorCode: e.code,
      });
    }
    return fail({ code: e.code, message: e.message });
  }
  captureException("action.unexpected_error", e, { scope: "action", operation: scope });
  return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
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
  return match;
}
