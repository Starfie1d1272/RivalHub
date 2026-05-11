import { fail } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, seasonRegistrations } from "@/db/schema";

// ── Error handling ──

export function failValidation(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

export function actionError(scope: string, e: unknown): ActionResult<never> {
  if (e instanceof AppError) return fail({ code: e.code, message: e.message });
  console.error(`[${scope}]`, e);
  return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
}

export function isPgUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e &&
    (e as { code: string }).code === "23505";
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

export async function getRegistrationOrThrow(registrationId: string) {
  const reg = await db.query.seasonRegistrations.findFirst({
    where: eq(seasonRegistrations.id, registrationId),
  });
  if (!reg) throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");
  return reg;
}
