"use server";

import { and, desc, eq, gte, lt, or, count, like, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, seasons, users } from "@/db/schema";
import { ok } from "@/types/action";
import { requireSuperAdmin } from "@/lib/auth/session";
import { actionError } from "@/lib/action-utils";

function escapeLike(s: string) {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

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
}

export async function fetchAuditLogs(filters: AuditLogFilters = {}) {
  try {
    await requireSuperAdmin();

    const {
      page,
      pageSize,
      seasonId,
      action,
      actorId,
      dateFrom,
      dateTo,
    } = filters;

    const safePage = positiveInt(page, 1);
    const safePageSize = positiveInt(pageSize, 50, 100);
    const conditions = [];
    if (seasonId) conditions.push(eq(auditLogs.seasonId, seasonId));
    if (action) conditions.push(like(auditLogs.action, `%${escapeLike(action)}%`));
    if (actorId) conditions.push(like(auditLogs.actorId, `%${escapeLike(actorId)}%`));
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

    const logs = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      meta: r.meta as Record<string, unknown> | null,
    }));

    // 构建 actorId → Steam 名称映射
    const actorIds = [...new Set(logs.map((l) => l.actorId).filter((id): id is string => id != null))];
    const actorNameMap: Record<string, string> = {};
    if (actorIds.length) {
      const actorUsers = await db
        .select({ id: users.id, email: users.email, steamName: users.steamName })
        .from(users)
        .where(or(inArray(users.id, actorIds), inArray(users.email, actorIds)));
      for (const u of actorUsers) {
        const name = u.steamName ?? u.email;
        actorNameMap[u.id] = name;
        if (u.email) actorNameMap[u.email] = name;
      }
    }

    return ok({ logs, total: Number(totalRow?.count ?? 0), actorNameMap });
  } catch (e) {
    return actionError("fetchAuditLogs", e);
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
