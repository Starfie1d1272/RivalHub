import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, communityGroups, seasonContacts, seasonPublicInfo } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

export type SeasonInfoAdminContext = { role: "season_admin" | "super_admin"; seasonIds: readonly string[]; actorId: string };

function assertSeasonAccess(context: SeasonInfoAdminContext, seasonId: string): void {
  if (context.role !== "super_admin" && !context.seasonIds.includes(seasonId)) throw new AppError(ErrorCode.FORBIDDEN, "你没有管理该赛事公开信息的权限。 ");
}

function audit(tx: TxDb, seasonId: string, actorId: string, action: string, targetId: string, meta?: Record<string, unknown>) {
  return tx.insert(auditLogs).values({ seasonId, actorId, action, targetId, targetType: "season_public_info", meta: meta ?? null });
}

export async function upsertSeasonPublicInfoInTx(tx: TxDb, context: SeasonInfoAdminContext, input: { seasonId: string; rulesLabel: string; rulesHref: string }) {
  assertSeasonAccess(context, input.seasonId);
  const existing = await tx.query.seasonPublicInfo.findFirst({ where: eq(seasonPublicInfo.seasonId, input.seasonId) });
  const [row] = existing
    ? await tx.update(seasonPublicInfo).set({ rulesLabel: input.rulesLabel, rulesHref: input.rulesHref, updatedAt: new Date() }).where(eq(seasonPublicInfo.id, existing.id)).returning()
    : await tx.insert(seasonPublicInfo).values({ seasonId: input.seasonId, rulesLabel: input.rulesLabel, rulesHref: input.rulesHref }).returning();
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "赛事规则入口保存失败。 ");
  await audit(tx, input.seasonId, context.actorId, existing ? "season_public_info.update" : "season_public_info.create", row.id);
  return row;
}

function assertActiveJoinMethod(input: { status: "active" | "closed"; groupNumber: string | null; qrImagePath: string | null; joinUrl: string | null }): void {
  if (input.status === "active" && !input.groupNumber && !input.qrImagePath && !input.joinUrl) throw new AppError(ErrorCode.VALIDATION_FAILED, "启用中的交流群至少需要群号、二维码或加入链接之一。 ");
}

export async function createCommunityGroupInTx(tx: TxDb, context: SeasonInfoAdminContext, input: { seasonId: string; label: string; audience: string | null; groupNumber: string | null; qrImagePath: string | null; joinUrl: string | null; note: string | null }) {
  assertSeasonAccess(context, input.seasonId);
  assertActiveJoinMethod({ ...input, status: "active" });
  const [last] = await tx.select({ sortOrder: communityGroups.sortOrder }).from(communityGroups).where(eq(communityGroups.seasonId, input.seasonId)).orderBy(desc(communityGroups.sortOrder)).limit(1);
  const [row] = await tx.insert(communityGroups).values({ ...input, sortOrder: (last?.sortOrder ?? -1) + 1 }).returning();
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "交流群创建失败。 ");
  await audit(tx, input.seasonId, context.actorId, "season_public_info.group.create", row.id);
  return row;
}

export async function updateCommunityGroupInTx(tx: TxDb, context: SeasonInfoAdminContext, id: string, input: { label: string; audience: string | null; groupNumber: string | null; qrImagePath: string | null; joinUrl: string | null; note: string | null; status: "active" | "closed" }) {
  const [existing] = await tx.select().from(communityGroups).where(eq(communityGroups.id, id)).for("update");
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "交流群不存在。 ");
  assertSeasonAccess(context, existing.seasonId);
  const normalizedInput = input.status === "closed" ? { ...input, groupNumber: null, qrImagePath: null, joinUrl: null } : input;
  assertActiveJoinMethod(normalizedInput);
  const [row] = await tx.update(communityGroups).set({ ...normalizedInput, updatedAt: new Date() }).where(eq(communityGroups.id, id)).returning();
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "交流群更新失败。 ");
  await audit(tx, row.seasonId, context.actorId, "season_public_info.group.update", row.id, { fromStatus: existing.status, toStatus: row.status });
  return { row, oldQrImagePath: existing.qrImagePath };
}

export async function deleteCommunityGroupInTx(tx: TxDb, context: SeasonInfoAdminContext, id: string) {
  const [existing] = await tx.select().from(communityGroups).where(eq(communityGroups.id, id)).for("update");
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "交流群不存在。 ");
  assertSeasonAccess(context, existing.seasonId);
  await tx.delete(communityGroups).where(eq(communityGroups.id, id));
  await audit(tx, existing.seasonId, context.actorId, "season_public_info.group.delete", id);
  return existing;
}

export async function moveCommunityGroupInTx(tx: TxDb, context: SeasonInfoAdminContext, id: string, direction: "up" | "down") {
  const [current] = await tx.select().from(communityGroups).where(eq(communityGroups.id, id)).for("update");
  if (!current) throw new AppError(ErrorCode.NOT_FOUND, "交流群不存在。 ");
  assertSeasonAccess(context, current.seasonId);
  const [neighbor] = await tx.select().from(communityGroups)
    .where(and(eq(communityGroups.seasonId, current.seasonId), direction === "up" ? lt(communityGroups.sortOrder, current.sortOrder) : gt(communityGroups.sortOrder, current.sortOrder)))
    .orderBy(direction === "up" ? desc(communityGroups.sortOrder) : asc(communityGroups.sortOrder))
    .limit(1);
  if (!neighbor) return current;
  await tx.update(communityGroups).set({ sortOrder: neighbor.sortOrder, updatedAt: new Date() }).where(eq(communityGroups.id, current.id));
  await tx.update(communityGroups).set({ sortOrder: current.sortOrder, updatedAt: new Date() }).where(eq(communityGroups.id, neighbor.id));
  await audit(tx, current.seasonId, context.actorId, "season_public_info.group.move", current.id, { direction });
  return current;
}

export async function createSeasonContactInTx(tx: TxDb, context: SeasonInfoAdminContext, input: { seasonId: string; label: string; publicName: string | null; value: string; href: string | null; note: string | null }) {
  assertSeasonAccess(context, input.seasonId);
  const [last] = await tx.select({ sortOrder: seasonContacts.sortOrder }).from(seasonContacts).where(eq(seasonContacts.seasonId, input.seasonId)).orderBy(desc(seasonContacts.sortOrder)).limit(1);
  const [row] = await tx.insert(seasonContacts).values({ ...input, sortOrder: (last?.sortOrder ?? -1) + 1 }).returning();
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "联系方式创建失败。 ");
  await audit(tx, input.seasonId, context.actorId, "season_public_info.contact.create", row.id);
  return row;
}

export async function updateSeasonContactInTx(tx: TxDb, context: SeasonInfoAdminContext, id: string, input: { label: string; publicName: string | null; value: string; href: string | null; note: string | null }) {
  const [existing] = await tx.select().from(seasonContacts).where(eq(seasonContacts.id, id)).for("update");
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "联系方式不存在。 ");
  assertSeasonAccess(context, existing.seasonId);
  const [row] = await tx.update(seasonContacts).set({ ...input, updatedAt: new Date() }).where(eq(seasonContacts.id, id)).returning();
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "联系方式更新失败。 ");
  await audit(tx, row.seasonId, context.actorId, "season_public_info.contact.update", row.id);
  return row;
}

export async function moveSeasonContactInTx(tx: TxDb, context: SeasonInfoAdminContext, id: string, direction: "up" | "down") {
  const [current] = await tx.select().from(seasonContacts).where(eq(seasonContacts.id, id)).for("update");
  if (!current) throw new AppError(ErrorCode.NOT_FOUND, "联系方式不存在。 ");
  assertSeasonAccess(context, current.seasonId);
  const [neighbor] = await tx.select().from(seasonContacts)
    .where(and(eq(seasonContacts.seasonId, current.seasonId), direction === "up" ? lt(seasonContacts.sortOrder, current.sortOrder) : gt(seasonContacts.sortOrder, current.sortOrder)))
    .orderBy(direction === "up" ? desc(seasonContacts.sortOrder) : asc(seasonContacts.sortOrder))
    .limit(1);
  if (!neighbor) return current;
  await tx.update(seasonContacts).set({ sortOrder: neighbor.sortOrder, updatedAt: new Date() }).where(eq(seasonContacts.id, current.id));
  await tx.update(seasonContacts).set({ sortOrder: current.sortOrder, updatedAt: new Date() }).where(eq(seasonContacts.id, neighbor.id));
  await audit(tx, current.seasonId, context.actorId, "season_public_info.contact.move", current.id, { direction });
  return current;
}

export async function deleteSeasonContactInTx(tx: TxDb, context: SeasonInfoAdminContext, id: string) {
  const [existing] = await tx.select().from(seasonContacts).where(eq(seasonContacts.id, id)).for("update");
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "联系方式不存在。 ");
  assertSeasonAccess(context, existing.seasonId);
  await tx.delete(seasonContacts).where(eq(seasonContacts.id, id));
  await audit(tx, existing.seasonId, context.actorId, "season_public_info.contact.delete", id);
  return existing;
}
