import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { announcements, auditLogs, type Announcement } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

export type AnnouncementAdminContext = {
  role: "season_admin" | "super_admin";
  seasonIds: readonly string[];
  actorId: string;
};

export type AnnouncementInput = {
  scope: "site" | "season";
  seasonId: string | null;
  type: "notice" | "product_update" | "important_alert";
  title: string;
  body: string;
  requiresAttention: boolean;
  attentionUntil: Date | null;
};

export function resolveAnnouncementPublishedAt(
  existing: Pick<Announcement, "status" | "publishedAt">,
  nextStatus: "draft" | "published",
  now: Date,
): Date | null {
  if (nextStatus !== "published") return existing.publishedAt;
  return existing.status === "published" ? (existing.publishedAt ?? now) : now;
}

function assertScopeAccess(context: AnnouncementAdminContext, scope: AnnouncementInput["scope"], seasonId: string | null): void {
  if (scope === "site") {
    if (context.role !== "super_admin" || seasonId !== null) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有超级管理员可以管理全站公告。 ");
    }
    return;
  }
  if (!seasonId || (context.role !== "super_admin" && !context.seasonIds.includes(seasonId))) {
    throw new AppError(ErrorCode.FORBIDDEN, "你没有管理该赛事公告的权限。 ");
  }
}

function auditAnnouncement(tx: TxDb, input: { seasonId: string | null; action: string; actorId: string; announcementId: string; meta?: Record<string, unknown> }) {
  return tx.insert(auditLogs).values({
    seasonId: input.seasonId,
    action: input.action,
    actorId: input.actorId,
    targetId: input.announcementId,
    targetType: "announcement",
    meta: input.meta ?? null,
  });
}

export async function createAnnouncementInTx(tx: TxDb, context: AnnouncementAdminContext, input: AnnouncementInput) {
  assertScopeAccess(context, input.scope, input.seasonId);
  const [row] = await tx.insert(announcements).values({
    scope: input.scope,
    seasonId: input.seasonId,
    type: input.type,
    title: input.title,
    body: input.body,
    requiresAttention: input.requiresAttention,
    attentionUntil: input.attentionUntil,
    createdBy: context.actorId,
    updatedBy: context.actorId,
  }).returning({ id: announcements.id, seasonId: announcements.seasonId });
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "公告创建失败。 ");
  await auditAnnouncement(tx, { seasonId: row.seasonId, action: "announcement.create", actorId: context.actorId, announcementId: row.id, meta: { scope: input.scope, type: input.type } });
  return row;
}

export async function updateAnnouncementInTx(tx: TxDb, context: AnnouncementAdminContext, id: string, input: AnnouncementInput) {
  const [existing] = await tx.select().from(announcements).where(eq(announcements.id, id)).for("update");
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "公告不存在。 ");
  assertScopeAccess(context, existing.scope, existing.seasonId);
  assertScopeAccess(context, input.scope, input.seasonId);
  const [row] = await tx.update(announcements).set({
    scope: input.scope,
    seasonId: input.seasonId,
    type: input.type,
    title: input.title,
    body: input.body,
    requiresAttention: input.requiresAttention,
    attentionUntil: input.attentionUntil,
    updatedBy: context.actorId,
    updatedAt: new Date(),
  }).where(eq(announcements.id, id)).returning({ id: announcements.id, seasonId: announcements.seasonId });
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "公告更新失败。 ");
  await auditAnnouncement(tx, { seasonId: row.seasonId, action: "announcement.update", actorId: context.actorId, announcementId: row.id, meta: { fromScope: existing.scope, toScope: input.scope, fromSeasonId: existing.seasonId, toSeasonId: input.seasonId, type: input.type } });
  return row;
}

export async function setAnnouncementStatusInTx(tx: TxDb, context: AnnouncementAdminContext, id: string, status: "draft" | "published") {
  const [existing] = await tx.select().from(announcements).where(eq(announcements.id, id)).for("update");
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "公告不存在。 ");
  assertScopeAccess(context, existing.scope, existing.seasonId);
  const now = new Date();
  const [row] = await tx.update(announcements).set({
    status,
    publishedAt: resolveAnnouncementPublishedAt(existing, status, now),
    updatedBy: context.actorId,
    updatedAt: now,
  }).where(and(eq(announcements.id, id), eq(announcements.status, existing.status))).returning({ id: announcements.id, seasonId: announcements.seasonId, status: announcements.status });
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "公告状态更新失败。 ");
  await auditAnnouncement(tx, { seasonId: row.seasonId, action: status === "published" ? "announcement.publish" : "announcement.unpublish", actorId: context.actorId, announcementId: row.id });
  return row;
}
