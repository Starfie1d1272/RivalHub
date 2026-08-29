"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLogs, competitivePlatformSeasons, competitiveRankFacts } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth, requireSuperAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";

const factSchema = z.object({ rank: z.string().trim().min(1).max(64), rating: z.coerce.number().finite().min(0).max(999999) });
const schema = z.object({ platform: z.string().trim().min(1).max(64), currentSeasonKey: z.string().trim().min(1).max(128), previousSeasonKey: z.string().trim().min(1).max(128), historicalPeak: factSchema, previousSeasonPeak: factSchema, currentSeasonPeak: factSchema });
const catalogSchema = z.object({ id: z.string().uuid().optional(), platform: z.string().trim().min(1).max(64), seasonKey: z.string().trim().min(1).max(128), label: z.string().trim().min(1).max(128), rankOrder: z.array(z.string().trim().min(1).max(64)).min(1).max(64), sortOrder: z.coerce.number().int().min(0).max(999999), active: z.boolean(), isCurrent: z.boolean() });

export async function saveCompetitiveProfile(input: unknown): Promise<ActionResult<void>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完整填写历史、上赛季和当前赛季最高段位及 Rating。" });
  try {
    const session = await requireAuth();
    if (parsed.data.currentSeasonKey === parsed.data.previousSeasonKey) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前赛季与上赛季标识不能相同。");
    await db.transaction(async (tx) => {
      const catalog = await tx.select({ seasonKey: competitivePlatformSeasons.seasonKey, isCurrent: competitivePlatformSeasons.isCurrent, active: competitivePlatformSeasons.active }).from(competitivePlatformSeasons).where(eq(competitivePlatformSeasons.platform, parsed.data.platform));
      const current = catalog.find((item) => item.seasonKey === parsed.data.currentSeasonKey);
      const previous = catalog.find((item) => item.seasonKey === parsed.data.previousSeasonKey);
      if (!current?.active || !current.isCurrent || !previous?.active) throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择平台目录中已启用的当前和上一赛季。");
      const facts = [{ kind: "historical_peak" as const, platformSeasonKey: null, value: parsed.data.historicalPeak }, { kind: "season_peak" as const, platformSeasonKey: parsed.data.previousSeasonKey, value: parsed.data.previousSeasonPeak }, { kind: "season_peak" as const, platformSeasonKey: parsed.data.currentSeasonKey, value: parsed.data.currentSeasonPeak }];
      for (const fact of facts) {
        const identity = fact.platformSeasonKey === null ? isNull(competitiveRankFacts.platformSeasonKey) : eq(competitiveRankFacts.platformSeasonKey, fact.platformSeasonKey);
        const existing = await tx.query.competitiveRankFacts.findFirst({ where: and(eq(competitiveRankFacts.userId, session.userId), eq(competitiveRankFacts.platform, parsed.data.platform), eq(competitiveRankFacts.kind, fact.kind), identity) });
        const values = { rank: fact.value.rank, rating: String(fact.value.rating), updatedAt: new Date() };
        if (existing) await tx.update(competitiveRankFacts).set(values).where(eq(competitiveRankFacts.id, existing.id));
        else await tx.insert(competitiveRankFacts).values({ userId: session.userId, platform: parsed.data.platform, kind: fact.kind, platformSeasonKey: fact.platformSeasonKey, rank: fact.value.rank, rating: String(fact.value.rating) });
      }
      await tx.insert(auditLogs).values({ action: "competitive_profile.self_declare", actorId: auditActorId(session), targetId: session.userId, targetType: "user", meta: { platform: parsed.data.platform, currentSeasonKey: parsed.data.currentSeasonKey, previousSeasonKey: parsed.data.previousSeasonKey } });
    });
    return ok(undefined);
  } catch (error) { return actionError("saveCompetitiveProfile", error); }
}

export async function saveCompetitivePlatformSeason(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完整填写平台赛季目录信息。" });
  try {
    const session = await requireSuperAdmin();
    const data = parsed.data;
    const result = await db.transaction(async (tx) => {
      if (data.isCurrent && !data.active) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前赛季必须处于启用状态。");
      if (data.isCurrent) await tx.update(competitivePlatformSeasons).set({ isCurrent: false, updatedAt: new Date() }).where(and(eq(competitivePlatformSeasons.platform, data.platform), eq(competitivePlatformSeasons.isCurrent, true)));
      const values = { platform: data.platform, seasonKey: data.seasonKey, label: data.label, rankOrder: [...new Set(data.rankOrder)], sortOrder: data.sortOrder, active: data.active, isCurrent: data.isCurrent, updatedAt: new Date() };
      const [row] = data.id
        ? await tx.update(competitivePlatformSeasons).set(values).where(eq(competitivePlatformSeasons.id, data.id)).returning({ id: competitivePlatformSeasons.id })
        : await tx.insert(competitivePlatformSeasons).values(values).returning({ id: competitivePlatformSeasons.id });
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "平台赛季目录项不存在。");
      await tx.insert(auditLogs).values({ action: "competitive_platform_season.save", actorId: auditActorId(session), targetId: row.id, targetType: "competitive_platform_season", meta: { platform: data.platform, seasonKey: data.seasonKey, isCurrent: data.isCurrent, active: data.active } });
      return row;
    });
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
      await tx.delete(competitivePlatformSeasons).where(eq(competitivePlatformSeasons.id, id));
      await tx.insert(auditLogs).values({ action: "competitive_platform_season.delete", actorId: auditActorId(session), targetId: id, targetType: "competitive_platform_season", meta: { platform: row.platform, seasonKey: row.seasonKey } });
    });
    return ok(undefined);
  } catch (error) { return actionError("deleteCompetitivePlatformSeason", error); }
}
