"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import {
  addMatchCommentatorInTx,
  confirmPostMatchReportInTx,
  removeMatchCommentatorInTx,
  returnPostMatchReportInTx,
  settleCommentatorInTx,
  setMatchVideoUrlInTx,
  submitPostMatchReportInTx,
} from "@/lib/postmatch/service";
import { fail, ok, type ActionResult } from "@/types/action";
import { ErrorCode, AppError } from "@/lib/errors";

const uuid = z.string().uuid();
const optionalUrl = z.string().url().max(2000).nullable().optional();

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

async function matchAndAdminOrThrow(matchId: string) {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId), columns: { id: true, seasonId: true } });
  if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。 ");
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, match.seasonId), columns: { slug: true } });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
  return { match, season, admin: await requireSeasonAdmin(match.seasonId) };
}

function revalidatePostMatch(slug: string, matchId?: string): void {
  revalidatePath(`/admin/${slug}/postmatch`);
  revalidatePath(`/admin/${slug}/matches`);
  revalidatePath(`/${slug}/matches`);
  if (matchId) revalidatePath(`/${slug}/matches/${matchId}`);
}

export async function addMatchCommentator(input: unknown): Promise<ActionResult<{ added: boolean }>> {
  const parsed = z.object({ matchId: uuid, userId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("解说参数无效。 ");
  try {
    const { match, season, admin } = await matchAndAdminOrThrow(parsed.data.matchId);
    const result = await db.transaction((tx) => addMatchCommentatorInTx(tx, { ...parsed.data, actorId: auditActorId(admin) }));
    revalidatePostMatch(season.slug, match.id);
    return ok({ added: result.added });
  } catch (error) { return actionError("addMatchCommentator", error); }
}

export async function removeMatchCommentator(input: unknown): Promise<ActionResult<{ removed: boolean }>> {
  const parsed = z.object({ matchId: uuid, userId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("解说参数无效。 ");
  try {
    const { match, season, admin } = await matchAndAdminOrThrow(parsed.data.matchId);
    const result = await db.transaction((tx) => removeMatchCommentatorInTx(tx, { ...parsed.data, actorId: auditActorId(admin) }));
    revalidatePostMatch(season.slug, match.id);
    return ok({ removed: result.removed });
  } catch (error) { return actionError("removeMatchCommentator", error); }
}

export async function updateMatchVideoUrl(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ matchId: uuid, videoUrl: optionalUrl }).safeParse(input);
  if (!parsed.success) return invalid("录像链接无效。 ");
  try {
    const { match, season, admin } = await matchAndAdminOrThrow(parsed.data.matchId);
    await db.transaction((tx) => setMatchVideoUrlInTx(tx, { matchId: match.id, videoUrl: parsed.data.videoUrl ?? null, actorId: auditActorId(admin) }));
    revalidatePostMatch(season.slug, match.id);
    return ok(undefined);
  } catch (error) { return actionError("updateMatchVideoUrl", error); }
}

export async function submitPostMatchReport(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ matchId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛后提交参数无效。 ");
  try {
    const { match, season, admin } = await matchAndAdminOrThrow(parsed.data.matchId);
    await db.transaction((tx) => submitPostMatchReportInTx(tx, { matchId: match.id, actorId: auditActorId(admin) }));
    revalidatePostMatch(season.slug, match.id);
    return ok(undefined);
  } catch (error) { return actionError("submitPostMatchReport", error); }
}

export async function confirmPostMatchReport(input: unknown): Promise<ActionResult<{ commentatorCount: number }>> {
  const parsed = z.object({ matchId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛后确认参数无效。 ");
  try {
    const { match, season, admin } = await matchAndAdminOrThrow(parsed.data.matchId);
    const result = await db.transaction((tx) => confirmPostMatchReportInTx(tx, { matchId: match.id, actorId: auditActorId(admin) }));
    revalidatePostMatch(season.slug, match.id);
    return ok({ commentatorCount: result.commentatorCount });
  } catch (error) { return actionError("confirmPostMatchReport", error); }
}

export async function returnPostMatchReport(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ matchId: uuid, reason: z.string().trim().min(1).max(1000) }).safeParse(input);
  if (!parsed.success) return invalid("退回原因无效。 ");
  try {
    const { match, season, admin } = await matchAndAdminOrThrow(parsed.data.matchId);
    await db.transaction((tx) => returnPostMatchReportInTx(tx, { ...parsed.data, actorId: auditActorId(admin) }));
    revalidatePostMatch(season.slug, match.id);
    return ok(undefined);
  } catch (error) { return actionError("returnPostMatchReport", error); }
}

export async function settleCommentator(input: unknown): Promise<ActionResult<{ settledMatches: number; settledFeeCents: number }>> {
  const parsed = z.object({ seasonId: uuid, userId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("结算参数无效。 ");
  try {
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, parsed.data.seasonId), columns: { id: true, slug: true } });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
    const admin = await requireSeasonAdmin(season.id);
    const result = await db.transaction((tx) => settleCommentatorInTx(tx, { ...parsed.data, actorId: auditActorId(admin) }));
    revalidatePostMatch(season.slug);
    return ok(result);
  } catch (error) { return actionError("settleCommentator", error); }
}
