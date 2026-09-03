"use server";

import { and, count, desc, eq, gte, inArray, like, lt, or } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, seasons, users } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { requireSeasonAdmin, requireSuperAdmin } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/identity/display-name";
import {
  getAuditActionPresentation,
  getAuditTargetTypeLabel,
  summarizeAuditMeta,
  type AuditLogView,
} from "@/lib/audit/presentation";
import { auditTargetKey, resolveAuditTargets } from "@/lib/audit/targets";
import { ok } from "@/types/action";

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
  /** Server-enforced scope used by the season-admin log page. */
  seasonScopeId?: string;
}

export interface AuditLogsData {
  logs: AuditLogView[];
  total: number;
}

function actorLabel(actorId: string | null, names: Record<string, string>): string {
  if (!actorId || actorId === "system" || actorId.startsWith("system:")) return "系统";
  return names[actorId] ?? `用户 · ${actorId.slice(0, 8)}`;
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

    const actorIds = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => id != null))];
    const actorNameMap: Record<string, string> = {};
    if (actorIds.length) {
      const uuidIds = actorIds.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      const nonUuidIds = actorIds.filter((id) => !uuidIds.includes(id));
      const clauses = [];
      if (uuidIds.length) clauses.push(inArray(users.id, uuidIds));
      if (nonUuidIds.length) clauses.push(inArray(users.email, nonUuidIds));
      if (clauses.length) {
        const actorUsers = await db.select({
          id: users.id,
          email: users.email,
          steamName: users.steamName,
          displayName: users.displayName,
          perfectName: users.perfectName,
        }).from(users).where(or(...clauses));
        for (const user of actorUsers) {
          const name = getDisplayName(user);
          actorNameMap[user.id] = name;
          if (user.email) actorNameMap[user.email] = name;
        }
      }
    }

    const targetMap = await resolveAuditTargets(rows.map((row) => ({
      targetType: row.targetType,
      targetId: row.targetId,
    })));

    const logs: AuditLogView[] = rows.map((row) => {
      const action = getAuditActionPresentation(row.action);
      const target = row.targetType && row.targetId
        ? targetMap[auditTargetKey(row.targetType, row.targetId)]
        : undefined;
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        actionKey: row.action,
        actionLabel: action.label,
        categoryLabel: action.categoryLabel,
        categoryColor: action.categoryColor,
        actorLabel: actorLabel(row.actorId, actorNameMap),
        targetTypeLabel: target?.typeLabel ?? getAuditTargetTypeLabel(row.targetType),
        targetLabel: target?.label ?? "未指定目标",
        summary: summarizeAuditMeta(row.action, row.meta),
      };
    });

    return ok<AuditLogsData>({ logs, total: Number(totalRow?.count ?? 0) });
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
