"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { postEventAdjudications, seasons, tournamentHonors } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  ADJUDICATION_IMPACTS,
  archiveTournamentInTx,
  confirmMajorFinalResultInTx,
  createPostEventAdjudicationInTx,
  grantTournamentHonorInTx,
  revokePostEventAdjudicationInTx,
  revokeTournamentHonorInTx,
  serializePostEventAdjudicationPublic,
  serializeTournamentHonorPublic,
} from "@/lib/postevent/service";
import { fail, ok, type ActionResult } from "@/types/action";

const uuid = z.string().uuid();
const clientRequestId = z.string().uuid();
const impactSchema = z.enum(ADJUDICATION_IMPACTS);

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

async function seasonAndAdminOrThrow(seasonId: string) {
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, seasonId), columns: { id: true, slug: true } });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。");
  return { season, admin: await requireSeasonAdmin(seasonId) };
}

function revalidatePostEvent(slug: string): void {
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/${slug}`);
  revalidatePath(`/${slug}/matches`);
  revalidatePath(`/admin/${slug}/matches`);
}

export async function confirmMajorFinalResult(input: unknown): Promise<ActionResult<{ resultId: string; alreadyConfirmed: boolean }>> {
  const parsed = z.object({ seasonId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛事结果确认参数无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => confirmMajorFinalResultInTx(tx, { seasonId: season.id, actorId: auditActorId(admin) }));
    revalidatePostEvent(season.slug);
    return ok(result);
  } catch (error) { return actionError("confirmMajorFinalResult", error); }
}

const createAdjudicationSchema = z.object({
  seasonId: uuid,
  clientRequestId,
  kind: z.enum(["team_sanction", "result_statement", "placement_statement", "honor_directive"]),
  target: z.enum(["season", "team", "user", "match"]),
  targetTeamId: uuid.optional().nullable(),
  targetUserId: uuid.optional().nullable(),
  targetMatchId: uuid.optional().nullable(),
  impacts: z.array(impactSchema).min(1).max(5),
  reason: z.string().trim().min(1).max(2000),
  publicExplanation: z.string().trim().min(1).max(2000),
  internalEvidence: z.string().trim().max(8000).optional().nullable(),
});

export async function createPostEventAdjudication(input: unknown): Promise<ActionResult<{ adjudicationId: string; created: boolean }>> {
  const parsed = createAdjudicationSchema.safeParse(input);
  if (!parsed.success) return invalid("赛后裁决参数无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => createPostEventAdjudicationInTx(tx, {
      ...parsed.data,
      seasonId: season.id,
      actorId: auditActorId(admin),
    }));
    revalidatePostEvent(season.slug);
    return ok(result);
  } catch (error) { return actionError("createPostEventAdjudication", error); }
}

export async function revokePostEventAdjudication(input: unknown): Promise<ActionResult<{ adjudicationId: string; alreadyRevoked: boolean }>> {
  const parsed = z.object({ adjudicationId: uuid, reason: z.string().trim().min(1).max(2000) }).safeParse(input);
  if (!parsed.success) return invalid("撤销裁决参数无效。");
  try {
    const [adjudication] = await db.select({ seasonId: postEventAdjudications.seasonId }).from(postEventAdjudications)
      .where(eq(postEventAdjudications.id, parsed.data.adjudicationId));
    if (!adjudication) throw new AppError(ErrorCode.NOT_FOUND, "赛后裁决不存在。");
    const { season, admin } = await seasonAndAdminOrThrow(adjudication.seasonId);
    const result = await db.transaction((tx) => revokePostEventAdjudicationInTx(tx, {
      adjudicationId: parsed.data.adjudicationId,
      actorId: auditActorId(admin),
      reason: parsed.data.reason,
    }));
    revalidatePostEvent(season.slug);
    return ok(result);
  } catch (error) { return actionError("revokePostEventAdjudication", error); }
}

const grantHonorSchema = z.object({
  seasonId: uuid,
  clientRequestId,
  type: z.enum(["champion", "runner_up", "placement", "manual_award"]),
  label: z.string().trim().min(1).max(160),
  basis: z.enum(["final_result", "manual", "adjudication"]),
  teamId: uuid.optional().nullable(),
  userId: uuid.optional().nullable(),
  placementFrom: z.number().int().positive().optional(),
  placementTo: z.number().int().positive().optional(),
  honorKey: z.string().trim().min(1).max(120).optional(),
  adjudicationId: uuid.optional().nullable(),
});

export async function grantTournamentHonor(input: unknown): Promise<ActionResult<{ honorId: string; created: boolean }>> {
  const parsed = grantHonorSchema.safeParse(input);
  if (!parsed.success) return invalid("荣誉授予参数无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => grantTournamentHonorInTx(tx, {
      ...parsed.data,
      seasonId: season.id,
      actorId: auditActorId(admin),
    }));
    revalidatePostEvent(season.slug);
    return ok(result);
  } catch (error) { return actionError("grantTournamentHonor", error); }
}

export async function revokeTournamentHonor(input: unknown): Promise<ActionResult<{ honorId: string; alreadyRevoked: boolean }>> {
  const parsed = z.object({ honorId: uuid, reason: z.string().trim().min(1).max(2000) }).safeParse(input);
  if (!parsed.success) return invalid("撤销荣誉参数无效。");
  try {
    const [honor] = await db.select({ seasonId: tournamentHonors.seasonId }).from(tournamentHonors)
      .where(eq(tournamentHonors.id, parsed.data.honorId));
    if (!honor) throw new AppError(ErrorCode.NOT_FOUND, "赛事荣誉不存在。");
    const { season, admin } = await seasonAndAdminOrThrow(honor.seasonId);
    const result = await db.transaction((tx) => revokeTournamentHonorInTx(tx, {
      honorId: parsed.data.honorId,
      actorId: auditActorId(admin),
      reason: parsed.data.reason,
    }));
    revalidatePostEvent(season.slug);
    return ok(result);
  } catch (error) { return actionError("revokeTournamentHonor", error); }
}

export async function archiveMajorTournament(input: unknown): Promise<ActionResult<{ archived: boolean; alreadyArchived: boolean }>> {
  const parsed = z.object({ seasonId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛事归档参数无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => archiveTournamentInTx(tx, { seasonId: season.id, actorId: auditActorId(admin) }));
    revalidatePostEvent(season.slug);
    return ok(result);
  } catch (error) { return actionError("archiveMajorTournament", error); }
}

export async function getSeasonPublicPostEventFacts(seasonId: string): Promise<ActionResult<{
  adjudications: ReturnType<typeof serializePostEventAdjudicationPublic>[];
  honors: ReturnType<typeof serializeTournamentHonorPublic>[];
}>> {
  if (!uuid.safeParse(seasonId).success) return invalid("赛季标识无效。");
  try {
    const [adjudications, honors] = await Promise.all([
      db.select().from(postEventAdjudications).where(eq(postEventAdjudications.seasonId, seasonId)),
      db.select().from(tournamentHonors).where(eq(tournamentHonors.seasonId, seasonId)),
    ]);
    return ok({
      adjudications: adjudications.map(serializePostEventAdjudicationPublic),
      honors: honors.map(serializeTournamentHonorPublic),
    });
  } catch (error) { return actionError("getSeasonPublicPostEventFacts", error); }
}
