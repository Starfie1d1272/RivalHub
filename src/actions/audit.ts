"use server";

import { and, count, desc, eq, gte, inArray, like, lt, or } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, seasons, steamProfiles, users } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { requireSeasonAdmin, requireSuperAdmin } from "@/lib/auth/session";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { escapeLikePattern } from "@/lib/db/search";
import {
  getAuditActionPresentation,
  getAuditTargetTypeLabel,
  summarizeAuditMeta,
  type AuditLogView,
} from "@/lib/audit/presentation";
import { auditTargetKey, normalizeAuditTarget, resolveAuditTargets } from "@/lib/audit/targets";
import { getAuditActorLabel, getAuditContextUserReferences, isAuditUserEmail, isAuditUserId, summarizeAuditPeople } from "@/lib/audit/people";
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

    const actorIds = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => id != null))];
    const contextUserIds = rows.flatMap((row) => [...getAuditContextUserReferences(row.action, row.meta).values()]);
    const userNameMap = new Map<string, string>();
    if (actorIds.length || contextUserIds.length) {
      const uuidIds = [...new Set([...actorIds.filter(isAuditUserId), ...contextUserIds])];
      const emailIds = actorIds.filter(isAuditUserEmail);
      const clauses = [];
      if (uuidIds.length) clauses.push(inArray(users.id, uuidIds));
      if (emailIds.length) clauses.push(inArray(users.email, emailIds));
      if (clauses.length) {
        const actorUsers = await db.select({
          id: users.id,
          email: users.email,
          personaName: steamProfiles.personaName,
          displayName: users.displayName,
          perfectName: users.perfectName,
        }).from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(or(...clauses));
        for (const user of actorUsers) {
          const name = getPublicDisplayName(user);
          userNameMap.set(user.id, name);
          if (user.email) userNameMap.set(user.email, name);
        }
      }
    }

    const targetRefs = rows.map((row) => ({
      action: row.action,
      meta: row.meta,
      targetType: row.targetType,
      targetId: row.targetId,
    }));
    const normalizedTargets = targetRefs.map(normalizeAuditTarget);
    const targetMap = await resolveAuditTargets(targetRefs);

    const logs: AuditLogView[] = rows.map((row, index) => {
      const action = getAuditActionPresentation(row.action);
      const normalizedTarget = normalizedTargets[index];
      const target = normalizedTarget?.targetType && normalizedTarget.targetId
        ? targetMap[auditTargetKey(normalizedTarget.targetType, normalizedTarget.targetId)]
        : undefined;
      const peopleSummary = summarizeAuditPeople(row.action, row.meta, userNameMap);
      const metaSummary = summarizeAuditMeta(row.action, row.meta);
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        actionKey: row.action,
        actionLabel: action.label,
        categoryLabel: action.categoryLabel,
        categoryColor: action.categoryColor,
        actorLabel: getAuditActorLabel(row.actorId, userNameMap),
        targetTypeLabel: target?.typeLabel ?? getAuditTargetTypeLabel(normalizedTarget?.targetType),
        targetLabel: target?.label ?? "未指定目标",
        summary: [peopleSummary, metaSummary === "已记录" && peopleSummary ? null : metaSummary].filter(Boolean).join(" · ") || null,
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
