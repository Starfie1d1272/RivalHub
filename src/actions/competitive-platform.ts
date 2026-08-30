"use server";

import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLogs, competitivePlatformRanks, competitivePlatformSeasons, competitivePlatforms, competitiveRankFacts } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireSuperAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";
import { assertPlatformRanksMutable, temporarySortOrders } from "@/lib/competitive/catalog";
import { isBuiltInCompetitivePlatformKey } from "@/lib/competitive/builtins";

/**
 * Operator mutations for the competitive platform catalog. Every action is
 * super_admin-only, transactional, audited, and keyed by stable identities:
 * platform key / seasonKey / rankKey never change after creation — only
 * display labels do. Structural changes that would rewrite the meaning of
 * long-term facts (deleting or reordering referenced ranks) fail closed.
 */

const seasonKeySchema = z.string().trim().min(1).max(128);
const rankKeySchema = z.string().trim().min(1).max(64);
const labelSchema = z.string().trim().min(1).max(128);
const ratingLabelSchema = z.string().trim().min(1).max(64);

function revalidateCatalog(): void {
  revalidatePath("/admin/competitive-seasons");
  revalidatePath("/settings");
  revalidatePath("/settings/competitive");
}

export async function updateCompetitivePlatform(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ key: z.string().trim().min(1).max(64), displayName: labelSchema, ratingLabel: ratingLabelSchema }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请填写平台显示名称和 canonical Rating 名称。" });
  try {
    const session = await requireSuperAdmin();
    const { key, displayName, ratingLabel } = parsed.data;
    if (!isBuiltInCompetitivePlatformKey(key)) throw new AppError(ErrorCode.VALIDATION_FAILED, "2.0 仅维护 Perfect World 与 5E 内置竞技平台。新增平台需要明确的产品与迁移变更。");
    await db.transaction(async (tx) => {
      const existing = await tx.query.competitivePlatforms.findFirst({ where: eq(competitivePlatforms.key, key) });
      if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "竞技平台不存在。");
      await tx.update(competitivePlatforms).set({ displayName, ratingLabel, updatedAt: new Date() }).where(eq(competitivePlatforms.key, key));
      await tx.insert(auditLogs).values({ action: "competitive_platform.update", actorId: auditActorId(session), targetId: key, targetType: "competitive_platform", meta: { key, displayName, ratingLabel } });
    });
    revalidateCatalog();
    return ok(undefined);
  } catch (error) { return actionError("updateCompetitivePlatform", error); }
}

// ── Season chronology ───────────────────────────────────────────────────────

export async function createCompetitivePlatformSeason(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ platform: z.string().trim().min(1).max(64), seasonKey: seasonKeySchema, label: labelSchema }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请填写所属平台、赛季标识和显示名称。" });
  try {
    const session = await requireSuperAdmin();
    const { platform, seasonKey, label } = parsed.data;
    if (!isBuiltInCompetitivePlatformKey(platform)) throw new AppError(ErrorCode.VALIDATION_FAILED, "2.0 仅维护 Perfect World 与 5E 内置竞技平台。新增平台需要明确的产品与迁移变更。");
    const result = await db.transaction(async (tx) => {
      const platformRow = await tx.query.competitivePlatforms.findFirst({ where: eq(competitivePlatforms.key, platform) });
      if (!platformRow) throw new AppError(ErrorCode.NOT_FOUND, "竞技平台不存在，请先创建平台。");
      const duplicate = await tx.query.competitivePlatformSeasons.findFirst({ where: and(eq(competitivePlatformSeasons.platform, platform), eq(competitivePlatformSeasons.seasonKey, seasonKey)) });
      if (duplicate) throw new AppError(ErrorCode.VALIDATION_FAILED, `该平台已存在赛季标识 ${seasonKey}；赛季标识创建后不可修改。`);
      const [{ maxOrder }] = await tx.select({ maxOrder: sql<number>`coalesce(max(${competitivePlatformSeasons.sortOrder}), -1)` }).from(competitivePlatformSeasons).where(eq(competitivePlatformSeasons.platform, platform));
      const [row] = await tx.insert(competitivePlatformSeasons).values({ platform, seasonKey, label, sortOrder: Number(maxOrder) + 1, active: true, isCurrent: false }).returning({ id: competitivePlatformSeasons.id });
      if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "赛季目录项创建失败。");
      await tx.insert(auditLogs).values({ action: "competitive_platform_season.create", actorId: auditActorId(session), targetId: row.id, targetType: "competitive_platform_season", meta: { platform, seasonKey, label } });
      return row;
    });
    revalidateCatalog();
    return ok(result);
  } catch (error) { return actionError("createCompetitivePlatformSeason", error); }
}

export async function updateCompetitivePlatformSeason(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: z.string().uuid(), label: labelSchema }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请填写赛季显示名称。" });
  try {
    const session = await requireSuperAdmin();
    const { id, label } = parsed.data;
    await db.transaction(async (tx) => {
      const existing = await tx.query.competitivePlatformSeasons.findFirst({ where: eq(competitivePlatformSeasons.id, id) });
      if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "赛季目录项不存在。");
      await tx.update(competitivePlatformSeasons).set({ label, updatedAt: new Date() }).where(eq(competitivePlatformSeasons.id, id));
      await tx.insert(auditLogs).values({ action: "competitive_platform_season.update", actorId: auditActorId(session), targetId: id, targetType: "competitive_platform_season", meta: { platform: existing.platform, seasonKey: existing.seasonKey, label } });
    });
    revalidateCatalog();
    return ok(undefined);
  } catch (error) { return actionError("updateCompetitivePlatformSeason", error); }
}

export async function setCompetitivePlatformSeasonActive(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: z.string().uuid(), active: z.boolean() }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "赛季目录项无效。" });
  try {
    const session = await requireSuperAdmin();
    const { id, active } = parsed.data;
    await db.transaction(async (tx) => {
      const existing = await tx.query.competitivePlatformSeasons.findFirst({ where: eq(competitivePlatformSeasons.id, id) });
      if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "赛季目录项不存在。");
      if (existing.isCurrent && !active) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前赛季必须保持启用；请先将当前赛季切换到其他赛季。");
      await tx.update(competitivePlatformSeasons).set({ active, updatedAt: new Date() }).where(eq(competitivePlatformSeasons.id, id));
      await tx.insert(auditLogs).values({ action: "competitive_platform_season.set_active", actorId: auditActorId(session), targetId: id, targetType: "competitive_platform_season", meta: { platform: existing.platform, seasonKey: existing.seasonKey, active } });
    });
    revalidateCatalog();
    return ok(undefined);
  } catch (error) { return actionError("setCompetitivePlatformSeasonActive", error); }
}

export async function setCurrentCompetitivePlatformSeason(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "赛季目录项无效。" });
  try {
    const session = await requireSuperAdmin();
    const { id } = parsed.data;
    await db.transaction(async (tx) => {
      const target = await tx.query.competitivePlatformSeasons.findFirst({ where: eq(competitivePlatformSeasons.id, id) });
      if (!target) throw new AppError(ErrorCode.NOT_FOUND, "赛季目录项不存在。");
      if (!target.active) throw new AppError(ErrorCode.VALIDATION_FAILED, "停用的赛季不能设为当前赛季，请先启用它。");
      const previous = await tx.query.competitivePlatformSeasons.findFirst({ where: and(eq(competitivePlatformSeasons.platform, target.platform), eq(competitivePlatformSeasons.isCurrent, true)) });
      if (previous?.id === id) return;
      // Exactly one current season per platform: clear the platform pointer
      // first, then set the new one — both inside this transaction.
      await tx.update(competitivePlatformSeasons).set({ isCurrent: false, updatedAt: new Date() }).where(and(eq(competitivePlatformSeasons.platform, target.platform), eq(competitivePlatformSeasons.isCurrent, true)));
      await tx.update(competitivePlatformSeasons).set({ isCurrent: true, updatedAt: new Date() }).where(eq(competitivePlatformSeasons.id, id));
      await tx.insert(auditLogs).values({ action: "competitive_platform_season.set_current", actorId: auditActorId(session), targetId: id, targetType: "competitive_platform_season", meta: { platform: target.platform, fromSeasonKey: previous?.seasonKey ?? null, toSeasonKey: target.seasonKey } });
    });
    revalidateCatalog();
    return ok(undefined);
  } catch (error) { return actionError("setCurrentCompetitivePlatformSeason", error); }
}

/**
 * Chronology swap with a two-phase update: both rows first move to unused
 * temporary positions (-1/-2) so the (platform, sortOrder) unique index is
 * never violated mid-transaction.
 */
export async function moveCompetitivePlatformSeason(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: z.string().uuid(), direction: z.enum(["up", "down"]) }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "排序指令无效。" });
  try {
    const session = await requireSuperAdmin();
    const { id, direction } = parsed.data;
    await db.transaction(async (tx) => {
      const row = await tx.query.competitivePlatformSeasons.findFirst({ where: eq(competitivePlatformSeasons.id, id) });
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "赛季目录项不存在。");
      const neighborWhere = direction === "up"
        ? and(eq(competitivePlatformSeasons.platform, row.platform), lt(competitivePlatformSeasons.sortOrder, row.sortOrder))
        : and(eq(competitivePlatformSeasons.platform, row.platform), gt(competitivePlatformSeasons.sortOrder, row.sortOrder));
      const [neighbor] = await tx.select().from(competitivePlatformSeasons).where(neighborWhere).orderBy(direction === "up" ? desc(competitivePlatformSeasons.sortOrder) : asc(competitivePlatformSeasons.sortOrder)).limit(1);
      if (!neighbor) return;
      const orders = await tx.select({ sortOrder: competitivePlatformSeasons.sortOrder }).from(competitivePlatformSeasons).where(eq(competitivePlatformSeasons.platform, row.platform));
      const [rowTemporary, neighborTemporary] = temporarySortOrders(orders.map((item) => item.sortOrder));
      await tx.update(competitivePlatformSeasons).set({ sortOrder: rowTemporary }).where(eq(competitivePlatformSeasons.id, row.id));
      await tx.update(competitivePlatformSeasons).set({ sortOrder: neighborTemporary }).where(eq(competitivePlatformSeasons.id, neighbor.id));
      await tx.update(competitivePlatformSeasons).set({ sortOrder: neighbor.sortOrder, updatedAt: new Date() }).where(eq(competitivePlatformSeasons.id, row.id));
      await tx.update(competitivePlatformSeasons).set({ sortOrder: row.sortOrder, updatedAt: new Date() }).where(eq(competitivePlatformSeasons.id, neighbor.id));
      await tx.insert(auditLogs).values({ action: "competitive_platform_season.move", actorId: auditActorId(session), targetId: id, targetType: "competitive_platform_season", meta: { platform: row.platform, seasonKey: row.seasonKey, direction } });
    });
    revalidateCatalog();
    return ok(undefined);
  } catch (error) { return actionError("moveCompetitivePlatformSeason", error); }
}

export async function deleteCompetitivePlatformSeason(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "赛季目录项无效。" });
  try {
    const session = await requireSuperAdmin();
    const { id } = parsed.data;
    await db.transaction(async (tx) => {
      const row = await tx.query.competitivePlatformSeasons.findFirst({ where: eq(competitivePlatformSeasons.id, id) });
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "赛季目录项不存在。");
      if (row.isCurrent) throw new AppError(ErrorCode.VALIDATION_FAILED, "该赛季是当前赛季；请先把其他赛季设为当前赛季后再删除。");
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
    revalidateCatalog();
    return ok(undefined);
  } catch (error) { return actionError("deleteCompetitivePlatformSeason", error); }
}

// ── Rank ladder ─────────────────────────────────────────────────────────────

export async function createCompetitivePlatformRank(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ platform: z.string().trim().min(1).max(64), rankKey: rankKeySchema, label: labelSchema }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请填写段位显示名称和稳定段位标识。" });
  try {
    const session = await requireSuperAdmin();
    const { platform, rankKey, label } = parsed.data;
    if (!isBuiltInCompetitivePlatformKey(platform)) throw new AppError(ErrorCode.VALIDATION_FAILED, "2.0 仅维护 Perfect World 与 5E 内置竞技平台。新增平台需要明确的产品与迁移变更。");
    const result = await db.transaction(async (tx) => {
      const platformRow = await tx.query.competitivePlatforms.findFirst({ where: eq(competitivePlatforms.key, platform) });
      if (!platformRow) throw new AppError(ErrorCode.NOT_FOUND, "竞技平台不存在，请先创建平台。");
      const key = rankKey;
      const duplicate = await tx.query.competitivePlatformRanks.findFirst({ where: and(eq(competitivePlatformRanks.platformKey, platform), eq(competitivePlatformRanks.rankKey, key)) });
      if (duplicate) throw new AppError(ErrorCode.VALIDATION_FAILED, `该平台已存在段位标识 ${key}；段位标识创建后不可修改。`);
      const [{ maxOrder }] = await tx.select({ maxOrder: sql<number>`coalesce(max(${competitivePlatformRanks.sortOrder}), -1)` }).from(competitivePlatformRanks).where(eq(competitivePlatformRanks.platformKey, platform));
      const [row] = await tx.insert(competitivePlatformRanks).values({ platformKey: platform, rankKey: key, label, sortOrder: Number(maxOrder) + 1 }).returning({ id: competitivePlatformRanks.id });
      if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "段位创建失败。");
      await tx.insert(auditLogs).values({ action: "competitive_platform_rank.create", actorId: auditActorId(session), targetId: row.id, targetType: "competitive_platform_rank", meta: { platform, rankKey: key, label } });
      return row;
    });
    revalidateCatalog();
    return ok(result);
  } catch (error) { return actionError("createCompetitivePlatformRank", error); }
}

export async function updateCompetitivePlatformRankLabel(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: z.string().uuid(), label: labelSchema }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请填写段位显示名称。" });
  try {
    const session = await requireSuperAdmin();
    const { id, label } = parsed.data;
    await db.transaction(async (tx) => {
      const existing = await tx.query.competitivePlatformRanks.findFirst({ where: eq(competitivePlatformRanks.id, id) });
      if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "段位不存在。");
      // Renaming only touches the display label; rankKey identity is immutable,
      // so existing facts and frozen event contexts stay valid.
      await tx.update(competitivePlatformRanks).set({ label, updatedAt: new Date() }).where(eq(competitivePlatformRanks.id, id));
      await tx.insert(auditLogs).values({ action: "competitive_platform_rank.rename", actorId: auditActorId(session), targetId: id, targetType: "competitive_platform_rank", meta: { platform: existing.platformKey, rankKey: existing.rankKey, label } });
    });
    revalidateCatalog();
    return ok(undefined);
  } catch (error) { return actionError("updateCompetitivePlatformRankLabel", error); }
}

export async function moveCompetitivePlatformRank(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: z.string().uuid(), direction: z.enum(["up", "down"]) }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "排序指令无效。" });
  try {
    const session = await requireSuperAdmin();
    const { id, direction } = parsed.data;
    await db.transaction(async (tx) => {
      const row = await tx.query.competitivePlatformRanks.findFirst({ where: eq(competitivePlatformRanks.id, id) });
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "段位不存在。");
      const neighborWhere = direction === "up"
        ? and(eq(competitivePlatformRanks.platformKey, row.platformKey), lt(competitivePlatformRanks.sortOrder, row.sortOrder))
        : and(eq(competitivePlatformRanks.platformKey, row.platformKey), gt(competitivePlatformRanks.sortOrder, row.sortOrder));
      const [neighbor] = await tx.select().from(competitivePlatformRanks).where(neighborWhere).orderBy(direction === "up" ? desc(competitivePlatformRanks.sortOrder) : asc(competitivePlatformRanks.sortOrder)).limit(1);
      if (!neighbor) return;
      // Long-term facts interpret ladder positions; swapping the order of a
      // referenced rank would silently rewrite their semantics. Without
      // ladder versioning this must fail closed.
      await assertPlatformRanksMutable(tx, row.platformKey, [row.rankKey, neighbor.rankKey]);
      const orders = await tx.select({ sortOrder: competitivePlatformRanks.sortOrder }).from(competitivePlatformRanks).where(eq(competitivePlatformRanks.platformKey, row.platformKey));
      const [rowTemporary, neighborTemporary] = temporarySortOrders(orders.map((item) => item.sortOrder));
      await tx.update(competitivePlatformRanks).set({ sortOrder: rowTemporary }).where(eq(competitivePlatformRanks.id, row.id));
      await tx.update(competitivePlatformRanks).set({ sortOrder: neighborTemporary }).where(eq(competitivePlatformRanks.id, neighbor.id));
      await tx.update(competitivePlatformRanks).set({ sortOrder: neighbor.sortOrder, updatedAt: new Date() }).where(eq(competitivePlatformRanks.id, row.id));
      await tx.update(competitivePlatformRanks).set({ sortOrder: row.sortOrder, updatedAt: new Date() }).where(eq(competitivePlatformRanks.id, neighbor.id));
      await tx.insert(auditLogs).values({ action: "competitive_platform_rank.move", actorId: auditActorId(session), targetId: id, targetType: "competitive_platform_rank", meta: { platform: row.platformKey, rankKey: row.rankKey, direction } });
    });
    revalidateCatalog();
    return ok(undefined);
  } catch (error) { return actionError("moveCompetitivePlatformRank", error); }
}

export async function deleteCompetitivePlatformRank(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "段位无效。" });
  try {
    const session = await requireSuperAdmin();
    const { id } = parsed.data;
    await db.transaction(async (tx) => {
      const row = await tx.query.competitivePlatformRanks.findFirst({ where: eq(competitivePlatformRanks.id, id) });
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "段位不存在。");
      await assertPlatformRanksMutable(tx, row.platformKey, [row.rankKey]);
      await tx.delete(competitivePlatformRanks).where(eq(competitivePlatformRanks.id, id));
      await tx.insert(auditLogs).values({ action: "competitive_platform_rank.delete", actorId: auditActorId(session), targetId: id, targetType: "competitive_platform_rank", meta: { platform: row.platformKey, rankKey: row.rankKey } });
    });
    revalidateCatalog();
    return ok(undefined);
  } catch (error) { return actionError("deleteCompetitivePlatformRank", error); }
}
