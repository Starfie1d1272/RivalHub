"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, competitivePlatformSeasons, competitiveRankFacts } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth, requireSuperAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";

const factSchema = z.object({ rank: z.string().trim().min(1).max(64), rating: z.coerce.number().finite().min(0).max(999999) });
const seasonPeakSchema = z.object({ seasonKey: z.string().trim().min(1).max(128), rank: z.string().trim().min(1).max(64), rating: z.coerce.number().finite().min(0).max(999999) });
const schema = z.object({
  platform: z.string().trim().min(1).max(64),
  historicalPeak: factSchema,
  /** One entry per catalogued platform season the participant wants to maintain. */
  seasonPeaks: z.array(seasonPeakSchema).max(64),
});
const catalogSchema = z.object({ id: z.string().uuid().optional(), platform: z.string().trim().min(1).max(64), seasonKey: z.string().trim().min(1).max(128), label: z.string().trim().min(1).max(128), rankOrder: z.array(z.string().trim().min(1).max(64)).min(1).max(64), sortOrder: z.coerce.number().int().min(0).max(999999), active: z.boolean(), isCurrent: z.boolean() });

/**
 * Long-term participant competitive profile. Facts are per catalogued platform
 * season — current/previous are not required, so a participant can backfill an
 * older season that a published event froze in its competitive context.
 */
export async function saveCompetitiveProfile(input: unknown): Promise<ActionResult<void>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完整填写历史最高段位及 Rating，以及需要维护的平台赛季最高段位。" });
  try {
    const session = await requireAuth();
    const { platform, historicalPeak, seasonPeaks } = parsed.data;
    if (new Set(seasonPeaks.map((peak) => peak.seasonKey)).size !== seasonPeaks.length) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "平台赛季资料不能重复同一赛季。");
    }
    await db.transaction(async (tx) => {
      const catalog = await tx.select().from(competitivePlatformSeasons).where(and(eq(competitivePlatformSeasons.platform, platform), eq(competitivePlatformSeasons.active, true)));
      for (const peak of seasonPeaks) {
        const entry = catalog.find((item) => item.seasonKey === peak.seasonKey);
        if (!entry) throw new AppError(ErrorCode.VALIDATION_FAILED, `平台赛季 ${peak.seasonKey} 不在目录中，不能保存。`);
        if (!entry.rankOrder.includes(peak.rank)) throw new AppError(ErrorCode.VALIDATION_FAILED, `段位 ${peak.rank} 不在平台赛季 ${entry.label} 公布的段位顺序中。`);
      }
      const facts = [
        { kind: "historical_peak" as const, platformSeasonKey: null as string | null, value: historicalPeak },
        ...seasonPeaks.map((peak) => ({ kind: "season_peak" as const, platformSeasonKey: peak.seasonKey, value: { rank: peak.rank, rating: peak.rating } })),
      ];
      for (const fact of facts) {
        const identity = fact.platformSeasonKey === null ? isNull(competitiveRankFacts.platformSeasonKey) : eq(competitiveRankFacts.platformSeasonKey, fact.platformSeasonKey);
        const existing = await tx.query.competitiveRankFacts.findFirst({ where: and(eq(competitiveRankFacts.userId, session.userId), eq(competitiveRankFacts.platform, platform), eq(competitiveRankFacts.kind, fact.kind), identity) });
        const values = { rank: fact.value.rank, rating: String(fact.value.rating), updatedAt: new Date() };
        if (existing) await tx.update(competitiveRankFacts).set(values).where(eq(competitiveRankFacts.id, existing.id));
        else await tx.insert(competitiveRankFacts).values({ userId: session.userId, platform, kind: fact.kind, platformSeasonKey: fact.platformSeasonKey, rank: fact.value.rank, rating: String(fact.value.rating) });
      }
      await tx.insert(auditLogs).values({ action: "competitive_profile.self_declare", actorId: auditActorId(session), targetId: session.userId, targetType: "user", meta: { platform, seasonKeys: seasonPeaks.map((peak) => peak.seasonKey) } });
    });
    return ok(undefined);
  } catch (error) { return actionError("saveCompetitiveProfile", error); }
}

/**
 * platform/seasonKey are immutable catalog identity. Edits may only change
 * label, rankOrder, sortOrder, active and isCurrent; a wrong identity must be
 * fixed by creating a new row instead of rewriting a referenced key.
 */
export async function saveCompetitivePlatformSeason(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完整填写平台赛季目录信息。" });
  try {
    const session = await requireSuperAdmin();
    const data = parsed.data;
    const result = await db.transaction(async (tx) => {
      let identity = { platform: data.platform, seasonKey: data.seasonKey };
      if (data.id) {
        const existing = await tx.query.competitivePlatformSeasons.findFirst({ where: eq(competitivePlatformSeasons.id, data.id) });
        if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "平台赛季目录项不存在。");
        if (existing.platform !== data.platform || existing.seasonKey !== data.seasonKey) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, "平台与赛季标识是目录项的固定身份，不能修改；如需更正请新建目录项。");
        }
        identity = { platform: existing.platform, seasonKey: existing.seasonKey };
      }
      if (data.isCurrent && !data.active) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前赛季必须处于启用状态。");
      if (data.isCurrent) await tx.update(competitivePlatformSeasons).set({ isCurrent: false, updatedAt: new Date() }).where(and(eq(competitivePlatformSeasons.platform, identity.platform), eq(competitivePlatformSeasons.isCurrent, true), data.id ? sql`${competitivePlatformSeasons.id} <> ${data.id}` : undefined));
      const values = { platform: identity.platform, seasonKey: identity.seasonKey, label: data.label, rankOrder: [...new Set(data.rankOrder)], sortOrder: data.sortOrder, active: data.active, isCurrent: data.isCurrent, updatedAt: new Date() };
      const [row] = data.id
        ? await tx.update(competitivePlatformSeasons).set(values).where(eq(competitivePlatformSeasons.id, data.id)).returning({ id: competitivePlatformSeasons.id })
        : await tx.insert(competitivePlatformSeasons).values(values).returning({ id: competitivePlatformSeasons.id });
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "平台赛季目录项不存在。");
      await tx.insert(auditLogs).values({ action: "competitive_platform_season.save", actorId: auditActorId(session), targetId: row.id, targetType: "competitive_platform_season", meta: { platform: identity.platform, seasonKey: identity.seasonKey, isCurrent: data.isCurrent, active: data.active } });
      return row;
    });
    revalidatePath("/admin/competitive-seasons");
    revalidatePath("/settings");
    revalidatePath("/settings/competitive");
    return ok(result);
  } catch (error) { return actionError("saveCompetitivePlatformSeason", error); }
}

export async function deleteCompetitivePlatformSeason(id: string): Promise<ActionResult<void>> {
  if (!z.string().uuid().safeParse(id).success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "平台赛季目录项无效。" });
  try {
    const session = await requireSuperAdmin();
    await db.transaction(async (tx) => {
      const row = await tx.query.competitivePlatformSeasons.findFirst({ where: eq(competitivePlatformSeasons.id, id) });
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "平台赛季目录项不存在。");
      const reference = await tx.query.competitiveRankFacts.findFirst({ where: and(eq(competitiveRankFacts.platform, row.platform), eq(competitiveRankFacts.platformSeasonKey, row.seasonKey)), columns: { id: true } });
      if (reference) throw new AppError(ErrorCode.VALIDATION_FAILED, "已有竞技资料引用该平台赛季，不能删除。");
      const frozen = await tx.execute(sql`
        SELECT id FROM seasons
        WHERE team_registration_config->'competitiveProfile'->>'platform' = ${row.platform}
          AND (
            team_registration_config->'competitiveProfile'->>'currentSeasonKey' = ${row.seasonKey}
            OR team_registration_config->'competitiveProfile'->>'previousSeasonKey' = ${row.seasonKey}
          )
        LIMIT 1
      `);
      if (frozen.rows.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "已有已发布赛事冻结的竞技上下文引用该平台赛季，不能删除。");
      await tx.delete(competitivePlatformSeasons).where(eq(competitivePlatformSeasons.id, id));
      await tx.insert(auditLogs).values({ action: "competitive_platform_season.delete", actorId: auditActorId(session), targetId: id, targetType: "competitive_platform_season", meta: { platform: row.platform, seasonKey: row.seasonKey } });
    });
    revalidatePath("/admin/competitive-seasons");
    revalidatePath("/settings");
    revalidatePath("/settings/competitive");
    return ok(undefined);
  } catch (error) { return actionError("deleteCompetitivePlatformSeason", error); }
}
