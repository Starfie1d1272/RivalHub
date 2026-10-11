"use server";

import { and, count, desc, eq, gte, like, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLogs, seasons } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireSeasonAdmin, requireSuperAdmin } from "@/lib/auth/session";
import { escapeLikePattern } from "@/lib/db/search";
import type { AuditLogView } from "@/lib/audit/presentation";
import { readAuditLogDetail, readAuditLogViews } from "@/lib/audit/read";
import { ok } from "@/types/action";

function parseCSTDateStart(value: string) {
  return new Date(`${value}T00:00:00+08:00`);
}

function parseCSTNextDateStart(value: string) {
  const date = parseCSTDateStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function positiveInt(value: number | undefined, fallback: number, max?: number) {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  const normalized = Math.floor(value);
  return max ? Math.min(normalized, max) : normalized;
}

export interface AuditLogFilters {
  page?: number;
  pageSize?: number;
  seasonId?: string;
  action?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Server-enforced scope used by the season-admin log page. */
  seasonScopeId?: string;
}

export interface AuditLogsData {
  logs: AuditLogView[];
  total: number;
}

export async function fetchAuditLogs(filters: AuditLogFilters = {}) {
  try {
    if (filters.seasonScopeId) await requireSeasonAdmin(filters.seasonScopeId);
    else await requireSuperAdmin();

    const {
      page,
      pageSize,
      seasonId,
      action,
      actorId,
      dateFrom,
      dateTo,
      seasonScopeId,
    } = filters;

    const safePage = positiveInt(page, 1);
    const safePageSize = positiveInt(pageSize, 50, 100);
    const conditions = [];
    if (seasonScopeId) conditions.push(eq(auditLogs.seasonId, seasonScopeId));
    else if (seasonId) conditions.push(eq(auditLogs.seasonId, seasonId));
    if (action) conditions.push(like(auditLogs.action, `%${escapeLikePattern(action)}%`));
    if (actorId) conditions.push(like(auditLogs.actorId, `%${escapeLikePattern(actorId)}%`));
    if (dateFrom) conditions.push(gte(auditLogs.createdAt, parseCSTDateStart(dateFrom)));
    if (dateTo) conditions.push(lt(auditLogs.createdAt, parseCSTNextDateStart(dateTo)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(safePageSize)
        .offset((safePage - 1) * safePageSize),
      db.select({ count: count() }).from(auditLogs).where(where),
    ]);

    const logs = await readAuditLogViews(rows);

    return ok<AuditLogsData>({ logs, total: Number(totalRow?.count ?? 0) });
  } catch (e) {
    return actionError("fetchAuditLogs", e);
  }
}

/** Re-authorize every detail request; list visibility is never an access grant. */
export async function fetchAuditLogDetail(input: unknown) {
  const parsed = z.object({ id: z.uuid(), seasonScopeId: z.uuid().optional() }).safeParse(input);
  if (!parsed.success) return failValidation("日志参数无效，请重新打开日志。");
  try {
    const { id, seasonScopeId } = parsed.data;
    if (seasonScopeId) await requireSeasonAdmin(seasonScopeId);
    else await requireSuperAdmin();
    const [row] = await db.select().from(auditLogs).where(and(
      eq(auditLogs.id, id),
      ...(seasonScopeId ? [eq(auditLogs.seasonId, seasonScopeId)] : []),
    )).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "未找到可访问的日志记录。");
    return ok(await readAuditLogDetail(row));
  } catch (error) {
    return actionError("fetchAuditLogDetail", error);
  }
}

export async function getAuditSeasons() {
  try {
    await requireSuperAdmin();
    const rows = await db.query.seasons.findMany({
      columns: { id: true, name: true },
      orderBy: [desc(seasons.createdAt)],
    });
    return ok(rows);
  } catch (e) {
    return actionError("getAuditSeasons", e);
  }
}
