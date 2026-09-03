"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLogs, competitivePlatforms, competitivePlatformRanks, competitivePlatformSeasons, competitiveRankFacts, userCompetitiveRoles } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";
import { CS2_POSITION_VALUES } from "@/lib/config/cs2-positions";
import { updatePublicPlayerTag } from "@/lib/revalidation";

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
      await tx.insert(auditLogs).values({
        seasonId: null,
        action: "competitive_roles.self_declare",
        actorId: auditActorId(session),
        targetId: session.userId,
        targetType: "user",
        meta: { roles: parsed.data.roles, primaryRole: parsed.data.primaryRole },
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
export async function saveCompetitiveProfile(input: unknown): Promise<ActionResult<void>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完整填写历史最高；每个赛季请选择未录入、未定级或已定级。" });
  try {
    const session = await requireAuth();
    const { platform, historicalPeak, seasonPeaks } = parsed.data;
    if (new Set(seasonPeaks.map((peak) => peak.seasonKey)).size !== seasonPeaks.length) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "平台赛季资料不能重复同一赛季。");
    }
    await db.transaction(async (tx) => {
      const [platformRow] = await tx.select().from(competitivePlatforms).where(eq(competitivePlatforms.key, platform)).limit(1);
      if (!platformRow) throw new AppError(ErrorCode.VALIDATION_FAILED, "竞技平台不存在，不能保存竞技档案。");
      const ladder = await tx.select().from(competitivePlatformRanks).where(eq(competitivePlatformRanks.platformKey, platform));
      const seasons = await tx.select().from(competitivePlatformSeasons).where(eq(competitivePlatformSeasons.platform, platform));
      const ladderByKey = new Map(ladder.map((rank) => [rank.rankKey, rank]));
      const seasonKeys = new Set(seasons.map((season) => season.seasonKey));
      const existingFacts = await tx.select().from(competitiveRankFacts).where(and(eq(competitiveRankFacts.userId, session.userId), eq(competitiveRankFacts.platform, platform)));
      const existingByKey = new Map(existingFacts.map((fact) => [fact.kind === "historical_peak" ? "historical_peak" : `season_peak:${fact.platformSeasonKey}`, fact]));
      const validateFact = (key: string, fact: { rank: string; rating: number; stars: number | null }) => {
        const rank = ladderByKey.get(fact.rank);
        if (!rank) throw new AppError(ErrorCode.VALIDATION_FAILED, `段位不在平台段位表中，不能保存：${fact.rank}`);
        if (rank.starMin === null) {
          if (fact.stars !== null) throw new AppError(ErrorCode.VALIDATION_FAILED, `${rank.label} 不使用星数，不能填写星数。`);
          return;
        }
        if (fact.stars !== null) {
          if (fact.stars < rank.starMin || (rank.starMax !== null && fact.stars > rank.starMax)) {
            const range = rank.starMax === null ? `${rank.starMin}+` : `${rank.starMin}–${rank.starMax}`;
            throw new AppError(ErrorCode.VALIDATION_FAILED, `${rank.label} 的星数必须在 ${range} 范围内。`);
          }
          return;
        }
        // Legacy facts predate exact stars. An untouched fact whose stored stars
        // are still null passes through unchanged instead of being blocked or
        // silently filled with a guessed value; any real edit must supply stars.
        const existing = existingByKey.get(key);
        const untouchedLegacy = existing !== undefined && existing.stars === null && existing.rank === fact.rank && Number(existing.rating) === fact.rating;
        if (!untouchedLegacy) throw new AppError(ErrorCode.VALIDATION_FAILED, `${rank.label} 需要填写准确星数。`);
      };
      if (historicalPeak.achievedSeasonKey && !seasonKeys.has(historicalPeak.achievedSeasonKey)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `历史最高达成赛季 ${historicalPeak.achievedSeasonKey} 不在目录中，不能保存。`);
      }
      for (const peak of seasonPeaks) {
        if (!seasonKeys.has(peak.seasonKey)) throw new AppError(ErrorCode.VALIDATION_FAILED, `平台赛季 ${peak.seasonKey} 不在目录中，不能保存。`);
        if (peak.status === "ranked") validateFact(`season_peak:${peak.seasonKey}`, peak);
      }
      validateFact("historical_peak", historicalPeak);
      const facts = [
        { key: "historical_peak", kind: "historical_peak" as const, platformSeasonKey: null as string | null, value: historicalPeak },
        ...seasonPeaks.map((peak) => ({ key: `season_peak:${peak.seasonKey}`, kind: "season_peak" as const, platformSeasonKey: peak.seasonKey, value: peak })),
      ];
      for (const fact of facts) {
        const existing = existingByKey.get(fact.key);
        if (fact.kind === "season_peak" && fact.value.status === "unrecorded") {
          if (existing) await tx.delete(competitiveRankFacts).where(eq(competitiveRankFacts.id, existing.id));
          continue;
        }
        if (fact.value.status !== "ranked" && fact.value.status !== "unranked") continue;
        const values = fact.value.status === "unranked"
          ? { status: "unranked" as const, rank: null, rating: fact.value.rating === null ? null : String(fact.value.rating), stars: null, achievedSeasonKey: null, updatedAt: new Date() }
          : { status: "ranked" as const, rank: fact.value.rank, rating: String(fact.value.rating), stars: fact.value.stars, achievedSeasonKey: fact.kind === "historical_peak" ? fact.value.achievedSeasonKey : null, updatedAt: new Date() };
        if (existing) await tx.update(competitiveRankFacts).set(values).where(eq(competitiveRankFacts.id, existing.id));
        else await tx.insert(competitiveRankFacts).values({ userId: session.userId, platform, kind: fact.kind, platformSeasonKey: fact.platformSeasonKey, ...values });
      }
      await tx.insert(auditLogs).values({ action: "competitive_profile.self_declare", actorId: auditActorId(session), targetId: session.userId, targetType: "user", meta: { platform, seasonKeys: seasonPeaks.map((peak) => peak.seasonKey) } });
    });
    updatePublicPlayerTag(session.userId);
    return ok(undefined);
  } catch (error) { return actionError("saveCompetitiveProfile", error); }
}
