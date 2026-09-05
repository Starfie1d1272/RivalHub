"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { competitionEntries } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { requestCompetitionEntryRosterChangeInTx } from "@/lib/competition-entries/roster-change";
import {
  confirmCompetitionEntryParticipationInTx,
  createCompetitionEntryInTx,
  declineCompetitionEntryParticipationInTx,
  grantCompetitionEntryRestrictionOverrideInTx,
  reviewCompetitionEntryInTx,
  revokeCompetitionEntryRestrictionOverrideInTx,
  saveCompetitionEntryRosterInTx,
  submitCompetitionEntryInTx,
  transferCompetitionEntryRepresentativeInTx,
  withdrawCompetitionEntryInTx,
  withdrawCompetitionEntryParticipationInTx,
} from "@/lib/competition-entries/commands";
import { fail, ok, type ActionResult } from "@/types/action";
import { traceOperation } from "@/lib/observability/server";

const uuid = z.string().uuid();
function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

function revalidateEntry(seasonSlug: string, entryId?: string): void {
  revalidatePath(`/${seasonSlug}/register`);
  revalidatePath(`/admin/${seasonSlug}/registrations`);
  revalidatePath("/my/competitions");
  if (entryId) revalidatePath(`/${seasonSlug}/entries/${entryId}`);
}

export async function createCompetitionEntry(input: { competitionId: string; teamId: string }): Promise<ActionResult<{ entryId: string }>> {
  const parsed = z.object({ competitionId: uuid, teamId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛事或队伍标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => createCompetitionEntryInTx(tx, { ...parsed.data, userId: session.userId, actorId: auditActorId(session) }));
    revalidateEntry(result.seasonSlug, result.entryId);
    return ok({ entryId: result.entryId });
  } catch (error) { return actionError("createCompetitionEntry", error); }
}

export async function saveCompetitionEntryRoster(input: { entryId: string; userIds: string[]; primaryStarterUserIds: string[]; perfectTeamId?: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid, userIds: z.array(uuid).min(1).max(9), primaryStarterUserIds: z.array(uuid).max(5), perfectTeamId: z.string().trim().max(128).optional() }).safeParse(input);
  if (!parsed.success || new Set(parsed.data.userIds).size !== parsed.data.userIds.length || new Set(parsed.data.primaryStarterUserIds).size !== parsed.data.primaryStarterUserIds.length || parsed.data.primaryStarterUserIds.some((id) => !parsed.data.userIds.includes(id))) return invalid("赛事名单或预定主力无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => saveCompetitionEntryRosterInTx(tx, { ...parsed.data, userId: session.userId, actorId: auditActorId(session) }));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("saveCompetitionEntryRoster", error); }
}

export async function confirmCompetitionEntryParticipation(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => confirmCompetitionEntryParticipationInTx(tx, { entryId: parsed.data.entryId, userId: session.userId, actorId: auditActorId(session) }));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("confirmCompetitionEntryParticipation", error); }
}

export async function withdrawCompetitionEntryParticipation(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => withdrawCompetitionEntryParticipationInTx(tx, { entryId: parsed.data.entryId, userId: session.userId, actorId: auditActorId(session) }));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("withdrawCompetitionEntryParticipation", error); }
}

export async function declineCompetitionEntryParticipation(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => declineCompetitionEntryParticipationInTx(tx, { entryId: parsed.data.entryId, userId: session.userId, actorId: auditActorId(session) }));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("declineCompetitionEntryParticipation", error); }
}

export async function withdrawCompetitionEntry(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => withdrawCompetitionEntryInTx(tx, {
      entryId: parsed.data.entryId,
      userId: session.userId,
      actorId: auditActorId(session),
    }));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("withdrawCompetitionEntry", error); }
}

export async function requestCompetitionEntryRosterChange(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => requestCompetitionEntryRosterChangeInTx(tx, {
      entryId: parsed.data.entryId,
      representativeUserId: session.userId,
      actorId: auditActorId(session),
    }));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("requestCompetitionEntryRosterChange", error); }
}

export async function submitCompetitionEntry(input: { entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("参赛条目标识无效。");
  try {
    const session = await requireAuth();
    const result = await traceOperation("competition_entry.submit", {
      scope: "competition_entry",
      operation: "submit",
      attributes: { "rivalhub.workflow": "competition_entry" },
    }, () => db.transaction((tx) => submitCompetitionEntryInTx(tx, {
      entryId: parsed.data.entryId,
      userId: session.userId,
      actorId: auditActorId(session),
    })));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("submitCompetitionEntry", error); }
}

export async function reviewCompetitionEntry(input: { entryId: string; decision: "changes_requested" | "waitlisted" | "approved" | "rejected"; reason?: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid, decision: z.enum(["changes_requested", "waitlisted", "approved", "rejected"]), reason: z.string().trim().max(1000).optional() }).safeParse(input);
  if (!parsed.success || ((parsed.data.decision === "changes_requested" || parsed.data.decision === "rejected") && !parsed.data.reason)) return invalid("审核决定或原因无效。");
  try {
    const existing = await db.query.competitionEntries.findFirst({ where: eq(competitionEntries.id, parsed.data.entryId), columns: { competitionId: true } });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
    const admin = await requireSeasonAdmin(existing.competitionId);
    const result = await traceOperation("competition_entry.review", {
      scope: "competition_entry",
      operation: "review",
      attributes: { "rivalhub.workflow": "competition_entry" },
    }, () => db.transaction((tx) => reviewCompetitionEntryInTx(tx, {
      entryId: parsed.data.entryId,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      actorId: auditActorId(admin),
    })));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("reviewCompetitionEntry", error); }
}

export async function grantCompetitionEntryRestrictionOverride(input: { entryId: string; restrictionCode: string; reason: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid, restrictionCode: z.string().trim().min(1).max(128), reason: z.string().trim().min(1).max(1000) }).safeParse(input);
  if (!parsed.success) return invalid("解除限制必须指定具体限制并填写非空理由。 ");
  try {
    const existing = await db.query.competitionEntries.findFirst({ where: eq(competitionEntries.id, parsed.data.entryId), columns: { competitionId: true } });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。 ");
    const admin = await requireSeasonAdmin(existing.competitionId);
    const result = await db.transaction((tx) => grantCompetitionEntryRestrictionOverrideInTx(tx, {
      ...parsed.data,
      actorId: auditActorId(admin),
    }));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("grantCompetitionEntryRestrictionOverride", error); }
}

export async function revokeCompetitionEntryRestrictionOverride(input: { entryId: string; restrictionCode: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid, restrictionCode: z.string().trim().min(1).max(128) }).safeParse(input);
  if (!parsed.success) return invalid("解除限制标识无效。 ");
  try {
    const existing = await db.query.competitionEntries.findFirst({ where: eq(competitionEntries.id, parsed.data.entryId), columns: { competitionId: true } });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。 ");
    const admin = await requireSeasonAdmin(existing.competitionId);
    const result = await db.transaction((tx) => revokeCompetitionEntryRestrictionOverrideInTx(tx, {
      ...parsed.data,
      actorId: auditActorId(admin),
    }));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("revokeCompetitionEntryRestrictionOverride", error); }
}

export async function transferCompetitionEntryRepresentative(input: { entryId: string; toUserId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ entryId: uuid, toUserId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛事负责人交接信息无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => transferCompetitionEntryRepresentativeInTx(tx, {
      entryId: parsed.data.entryId,
      userId: session.userId,
      toUserId: parsed.data.toUserId,
      actorId: auditActorId(session),
    }));
    revalidateEntry(result.seasonSlug, parsed.data.entryId);
    return ok(undefined);
  } catch (error) { return actionError("transferCompetitionEntryRepresentative", error); }
}
