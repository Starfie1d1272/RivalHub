"use server";

import { and, desc, eq, gte, lte, count, like } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, seasons } from "@/db/schema";
import { ok } from "@/types/action";
import { requireSuperAdmin } from "@/lib/auth/session";
import { actionError } from "@/lib/action-utils";

function escapeLike(s: string) {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
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
      page = 1,
      pageSize = 50,
      seasonId,
      action,
      actorId,
      dateFrom,
      dateTo,
    } = filters;

    const conditions = [];
    if (seasonId) conditions.push(eq(auditLogs.seasonId, seasonId));
    if (action) conditions.push(like(auditLogs.action, `%${escapeLike(action)}%`));
    if (actorId) conditions.push(like(auditLogs.actorId, `%${escapeLike(actorId)}%`));
    if (dateFrom) conditions.push(gte(auditLogs.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(auditLogs.createdAt, new Date(dateTo)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ count: count() }).from(auditLogs).where(where),
    ]);

    const logs = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      meta: r.meta as Record<string, unknown> | null,
    }));

    return ok({ logs, total: Number(totalRow?.count ?? 0) });
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
