"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { actionError, isPgUniqueViolation } from "@/lib/action-utils";
import { auditActorId, requireAuth } from "@/lib/auth/session";
import { CS2_POSITION_VALUES } from "@/lib/config/cs2-positions";
import {
  closeTeamRecruitmentInTx,
  closePlayerLftInTx,
  dismissRecruitmentInterestInTx,
  expressRecruitmentInterestInTx,
  upsertPlayerLftInTx,
  upsertTeamRecruitmentInTx,
  withdrawRecruitmentInterestInTx,
} from "@/lib/recruitment/commands";
import { ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";

const uuid = z.string().uuid();
const position = z.enum(CS2_POSITION_VALUES);
const optionalNote = z.string().trim().max(280).optional();
const optionalSeason = uuid.nullable().optional();
const teamPositions = z.array(position).max(CS2_POSITION_VALUES.length).refine((positions) => new Set(positions).size === positions.length, "位置不能重复");
const playerPositions = z.array(position).min(1).max(3).refine((positions) => new Set(positions).size === positions.length, "位置不能重复");

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

function revalidateRecruitment(userId?: string, teamSlug?: string): void {
  revalidatePath("/teams");
  revalidatePath("/teams/recruitment");
  revalidatePath("/my");
  revalidatePath("/my/teams");
  if (userId) revalidatePath(`/players/${userId}`);
  if (teamSlug) revalidatePath(`/teams/${teamSlug}`);
}

export async function saveTeamRecruitment(input: { teamId: string; positions: string[]; targetSeasonId?: string | null; note?: string }): Promise<ActionResult<{ expiresAt: string }>> {
  const parsed = z.object({ teamId: uuid, positions: teamPositions, targetSeasonId: optionalSeason, note: optionalNote }).safeParse(input);
  if (!parsed.success) return invalid("招募信息无效：最多可选择五个位置，说明不超过 280 字。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => upsertTeamRecruitmentInTx(tx, {
      teamId: parsed.data.teamId,
      userId: session.userId,
      actorId: auditActorId(session),
      positions: parsed.data.positions,
      targetSeasonId: parsed.data.targetSeasonId ?? null,
      note: parsed.data.note || null,
    }));
    revalidateRecruitment();
    return ok({ expiresAt: result.expiresAt.toISOString() });
  } catch (error) { return actionError("saveTeamRecruitment", error); }
}

export async function closeTeamRecruitment(input: { teamId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("队伍标识无效。");
  try {
    const session = await requireAuth();
    await db.transaction((tx) => closeTeamRecruitmentInTx(tx, { teamId: parsed.data.teamId, userId: session.userId, actorId: auditActorId(session) }));
    revalidateRecruitment();
    return ok(undefined);
  } catch (error) { return actionError("closeTeamRecruitment", error); }
}

export async function savePlayerLft(input: { positions: string[]; targetSeasonId?: string | null; note?: string }): Promise<ActionResult<{ expiresAt: string }>> {
  const parsed = z.object({ positions: playerPositions, targetSeasonId: optionalSeason, note: optionalNote }).safeParse(input);
  if (!parsed.success) return invalid("找队信息无效：请选择 1-3 个位置，说明不超过 280 字。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => upsertPlayerLftInTx(tx, {
      userId: session.userId,
      actorId: auditActorId(session),
      positions: parsed.data.positions,
      targetSeasonId: parsed.data.targetSeasonId ?? null,
      note: parsed.data.note || null,
    }));
    revalidateRecruitment(session.userId);
    return ok({ expiresAt: result.expiresAt.toISOString() });
  } catch (error) { return actionError("savePlayerLft", error); }
}

export async function closePlayerLft(): Promise<ActionResult<void>> {
  try {
    const session = await requireAuth();
    await db.transaction((tx) => closePlayerLftInTx(tx, { userId: session.userId, actorId: auditActorId(session) }));
    revalidateRecruitment(session.userId);
    return ok(undefined);
  } catch (error) { return actionError("closePlayerLft", error); }
}

export async function expressRecruitmentInterest(input: { recruitmentIntentId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ recruitmentIntentId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("招募信息无效。");
  try {
    const session = await requireAuth();
    await db.transaction((tx) => expressRecruitmentInterestInTx(tx, { recruitmentIntentId: parsed.data.recruitmentIntentId, userId: session.userId, actorId: auditActorId(session) }));
    revalidateRecruitment(session.userId);
    return ok(undefined);
  } catch (error) {
    if (isPgUniqueViolation(error)) return invalid("你已表达过加入意向。");
    return actionError("expressRecruitmentInterest", error);
  }
}

export async function withdrawRecruitmentInterest(input: { recruitmentIntentId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ recruitmentIntentId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("招募信息无效。");
  try {
    const session = await requireAuth();
    await db.transaction((tx) => withdrawRecruitmentInterestInTx(tx, { recruitmentIntentId: parsed.data.recruitmentIntentId, userId: session.userId, actorId: auditActorId(session) }));
    revalidateRecruitment(session.userId);
    return ok(undefined);
  } catch (error) { return actionError("withdrawRecruitmentInterest", error); }
}

export async function dismissRecruitmentInterest(input: { recruitmentIntentId: string; userId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ recruitmentIntentId: uuid, userId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("加入意向无效。");
  try {
    const session = await requireAuth();
    await db.transaction((tx) => dismissRecruitmentInterestInTx(tx, { recruitmentIntentId: parsed.data.recruitmentIntentId, interestUserId: parsed.data.userId, userId: session.userId, actorId: auditActorId(session) }));
    revalidateRecruitment(parsed.data.userId);
    return ok(undefined);
  } catch (error) { return actionError("dismissRecruitmentInterest", error); }
}
