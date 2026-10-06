"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { userCompetitiveRoles, userMapPreferences } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";
import { CS2_POSITION_VALUES } from "@/lib/config/cs2-positions";
import { updatePublicPlayerTag } from "@/lib/revalidation";
import { longTermMapPreferencesSchema } from "@/lib/validators/map-preferences";

import type { normalizeCompetitivePeaks } from "@/lib/competitive/normalize-profile";

import { saveCompetitiveProfileInTx } from "@/lib/competitive/save-profile";

const starsSchema = z.number().int().nonnegative().nullable().optional().default(null);
const rankedFactSchema = z.object({ status: z.literal("ranked").optional().default("ranked"), rank: z.string().trim().min(1).max(64), rating: z.coerce.number().finite().min(0).max(999999), stars: starsSchema });
const historicalFactSchema = rankedFactSchema.extend({ achievedSeasonKey: z.string().trim().min(1).max(128).nullable().optional().default(null) });
const seasonPeakSchema = z.object({ seasonKey: z.string().trim().min(1).max(128) }).and(z.union([
  rankedFactSchema,
  z.object({ status: z.literal("unranked"), rating: z.coerce.number().finite().min(0).max(999999).nullable().optional().default(null) }),
  z.object({ status: z.literal("unrecorded") }),
]));
const schema = z.object({
  platform: z.string().trim().min(1).max(64),
  historicalPeak: historicalFactSchema,
  /** Each listed catalog season is explicitly ranked, unranked, or unrecorded. */
  seasonPeaks: z.array(seasonPeakSchema).max(64),
});
const roleSchema = z.enum(CS2_POSITION_VALUES);

export async function saveCompetitiveRoles(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ roles: z.array(roleSchema).min(1).max(3), primaryRole: roleSchema }).safeParse(input);
  if (!parsed.success || !parsed.data.roles.includes(parsed.data.primaryRole) || new Set(parsed.data.roles).size !== parsed.data.roles.length) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请选择 1–3 个不重复的位置，并从中指定一个主位置。" });
  }
  try {
    const session = await requireAuth();
    await db.transaction(async (tx) => {
      await tx.delete(userCompetitiveRoles).where(eq(userCompetitiveRoles.userId, session.userId));
      await tx.insert(userCompetitiveRoles).values(parsed.data.roles.map((role) => ({
        userId: session.userId,
        role,
        isPrimary: role === parsed.data.primaryRole,
      })));
      await writeAuditInTx(tx, {
        seasonId: null,
        action: "competitive_roles.self_declare",
        actorId: auditActorId(session),
        targetId: session.userId,meta: { roles: parsed.data.roles, primaryRole: parsed.data.primaryRole },
      });
    });
    revalidatePath("/settings/competitive");
    revalidatePath(`/players/${session.userId}`);
    revalidatePath("/my/teams");
    updatePublicPlayerTag(session.userId);
    return ok(undefined);
  } catch (error) { return actionError("saveCompetitiveRoles", error); }
}

/**
 * Long-term participant competitive profile. Facts store stable rank keys from
 * the platform ladder — not display labels — and may target any catalogued
 * season, including inactive historical seasons a published event froze into
 * its qualification context.
 */
export async function saveCompetitiveProfile(input: unknown): Promise<ActionResult<ReturnType<typeof normalizeCompetitivePeaks>>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完整填写历史最高；每个赛季请选择未录入、未定级或已定级。" });
  try {
    const session = await requireAuth();
    const { platform, historicalPeak, seasonPeaks } = parsed.data;
    if (new Set(seasonPeaks.map((peak) => peak.seasonKey)).size !== seasonPeaks.length) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "平台赛季资料不能重复同一赛季。");
    }
    const normalized = await db.transaction(async (tx) => {
      return saveCompetitiveProfileInTx(tx, { userId: session.userId, actorId: auditActorId(session), platform, historicalPeak, seasonPeaks });
    });
    updatePublicPlayerTag(session.userId);
    revalidatePath("/settings/competitive");
    return ok(normalized);
  } catch (error) { return actionError("saveCompetitiveProfile", error); }
}

/**
 * Long-lived map proficiency — the canonical user-level owner reused by season
 * registrations (pre-fill) and the recruitment lobby (summary display).
 */
export async function saveMapPreferences(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ mapPreferences: longTermMapPreferencesSchema() }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "长期地图资料只能保存稳定地图目录中的不重复熟练度事实；未填写地图无需提交。" });
  try {
    const session = await requireAuth();
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx.insert(userMapPreferences)
        .values({ userId: session.userId, mapPreferences: parsed.data.mapPreferences, updatedAt: now })
        .onConflictDoUpdate({
          target: userMapPreferences.userId,
          set: { mapPreferences: parsed.data.mapPreferences, updatedAt: now },
        });
      await writeAuditInTx(tx, {
        seasonId: null,
        action: "map_preferences.self_declare",
        actorId: auditActorId(session),
        targetId: session.userId,meta: { mapCount: parsed.data.mapPreferences.length },
      });
    });
    revalidatePath("/settings/competitive");
    revalidatePath(`/players/${session.userId}`);
    revalidatePath("/teams/recruitment");
    updatePublicPlayerTag(session.userId);
    return ok(undefined);
  } catch (error) { return actionError("saveMapPreferences", error); }
}
