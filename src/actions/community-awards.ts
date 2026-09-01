"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { communityAwards, seasons } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import {
  addCommunityAwardEvidenceInTx,
  requestCommunityAwardSupplementInTx,
  resolveCommunityAwardInTx,
  reviewCommunityAwardInTx,
  reviseCommunityAwardInTx,
  submitCommunityAwardInTx,
  withdrawCommunityAwardInTx,
} from "@/lib/community-awards/service";
import { AppError, ErrorCode } from "@/lib/errors";
import { isHttpUrl } from "@/lib/external-url";
import { fail, ok, type ActionResult } from "@/types/action";

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const awardInput = z.object({
  seasonId: uuid,
  name: z.string().trim().min(1).max(160),
  condition: z.string().trim().min(1).max(3000),
  prize: z.string().trim().min(1).max(1000),
  supplementaryNote: optionalText(3000),
});

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

function revalidateAwards(slug: string): void {
  revalidatePath(`/${slug}/community-awards`);
  revalidatePath(`/admin/${slug}/community-awards`);
}

async function awardAndAdminOrThrow(awardId: string) {
  const award = await db.query.communityAwards.findFirst({ where: eq(communityAwards.id, awardId), columns: { id: true, seasonId: true } });
  if (!award) throw new AppError(ErrorCode.NOT_FOUND, "社区奖不存在。 ");
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, award.seasonId), columns: { id: true, slug: true } });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
  return { award, season, admin: await requireSeasonAdmin(season.id) };
}

export async function submitCommunityAward(input: unknown): Promise<ActionResult<{ awardId: string }>> {
  const parsed = awardInput.safeParse(input);
  if (!parsed.success) return invalid("社区奖信息不完整或格式无效。 ");
  try {
    const user = await requireAuth();
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, parsed.data.seasonId), columns: { slug: true } });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
    const result = await db.transaction((tx) => submitCommunityAwardInTx(tx, { ...parsed.data, submitterId: user.userId }));
    revalidateAwards(season.slug);
    return ok(result);
  } catch (error) { return actionError("submitCommunityAward", error); }
}

export async function reviseCommunityAward(input: unknown): Promise<ActionResult<void>> {
  const parsed = awardInput.extend({ awardId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("社区奖补充信息无效。 ");
  try {
    const user = await requireAuth();
    const award = await db.query.communityAwards.findFirst({ where: eq(communityAwards.id, parsed.data.awardId), columns: { seasonId: true } });
    if (!award || award.seasonId !== parsed.data.seasonId) throw new AppError(ErrorCode.NOT_FOUND, "社区奖不存在。 ");
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, award.seasonId), columns: { slug: true } });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
    await db.transaction((tx) => reviseCommunityAwardInTx(tx, { ...parsed.data, submitterId: user.userId }));
    revalidateAwards(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("reviseCommunityAward", error); }
}

export async function reviewCommunityAward(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ awardId: uuid, status: z.enum(["approved", "rejected"]), publicNote: optionalText(2000), reviewNote: optionalText(2000) }).safeParse(input);
  if (!parsed.success) return invalid("审核参数无效。 ");
  try {
    const { award, season, admin } = await awardAndAdminOrThrow(parsed.data.awardId);
    await db.transaction((tx) => reviewCommunityAwardInTx(tx, { ...parsed.data, awardId: award.id, actorId: auditActorId(admin) }));
    revalidateAwards(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("reviewCommunityAward", error); }
}

export async function requestCommunityAwardSupplement(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ awardId: uuid, note: z.string().trim().min(1).max(2000) }).safeParse(input);
  if (!parsed.success) return invalid("补充说明无效。 ");
  try {
    const { award, season, admin } = await awardAndAdminOrThrow(parsed.data.awardId);
    await db.transaction((tx) => requestCommunityAwardSupplementInTx(tx, { ...parsed.data, awardId: award.id, actorId: auditActorId(admin) }));
    revalidateAwards(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("requestCommunityAwardSupplement", error); }
}

export async function withdrawCommunityAward(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ awardId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("撤回参数无效。 ");
  try {
    const user = await requireAuth();
    const award = await db.query.communityAwards.findFirst({ where: eq(communityAwards.id, parsed.data.awardId), columns: { seasonId: true } });
    if (!award) throw new AppError(ErrorCode.NOT_FOUND, "社区奖不存在。 ");
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, award.seasonId), columns: { slug: true } });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
    await db.transaction((tx) => withdrawCommunityAwardInTx(tx, { awardId: parsed.data.awardId, submitterId: user.userId }));
    revalidateAwards(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("withdrawCommunityAward", error); }
}

export async function addCommunityAwardEvidence(input: unknown): Promise<ActionResult<{ evidenceId: string }>> {
  const parsed = z.object({ awardId: uuid, candidateUserId: uuid.nullable().optional(), matchId: uuid.nullable().optional(), explanation: z.string().trim().min(1).max(3000), videoUrl: z.string().trim().max(2000).refine(isHttpUrl, "证据视频链接必须是 http 或 https URL").nullable().optional() }).safeParse(input);
  if (!parsed.success) return invalid("证据资料无效。 ");
  try {
    const user = await requireAuth();
    const award = await db.query.communityAwards.findFirst({ where: eq(communityAwards.id, parsed.data.awardId), columns: { seasonId: true } });
    if (!award) throw new AppError(ErrorCode.NOT_FOUND, "社区奖不存在。 ");
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, award.seasonId), columns: { slug: true } });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
    const result = await db.transaction((tx) => addCommunityAwardEvidenceInTx(tx, { ...parsed.data, submitterId: user.userId }));
    revalidateAwards(season.slug);
    return ok({ evidenceId: result.evidenceId });
  } catch (error) { return actionError("addCommunityAwardEvidence", error); }
}

export async function resolveCommunityAward(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ awardId: uuid, status: z.enum(["awarded", "not_awarded", "cancelled"]), recipientUserId: uuid.nullable().optional(), outcomeNote: z.string().trim().min(1).max(2000) }).safeParse(input);
  if (!parsed.success) return invalid("结奖参数无效。 ");
  try {
    const { award, season, admin } = await awardAndAdminOrThrow(parsed.data.awardId);
    await db.transaction((tx) => resolveCommunityAwardInTx(tx, { ...parsed.data, awardId: award.id, actorId: auditActorId(admin) }));
    revalidateAwards(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("resolveCommunityAward", error); }
}
