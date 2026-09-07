import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { disciplinaryCases, users } from "@/db/schema";
import { getDisplayName } from "@/lib/identity/display-name";
import { resolveSanctionStatus } from "@/lib/discipline/service";
import {
  DISCIPLINE_ADMIN_DEFAULTS,
  DISCIPLINE_ADMIN_PAGE_SIZE,
  type DisciplineAdminQuery,
  type DisciplineAdminResult,
  type DisciplineAdminSearchParams,
  type DisciplineAdminSort,
  type DisciplineAdminStatus,
  type DisciplineSanctionRow,
} from "./admin-review-contract";

const DISCIPLINE_STATUSES = ["all", "active", "draft", "expired", "revoked"] as const;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readParam(input: DisciplineAdminSearchParams, key: string): string | undefined {
  return input instanceof URLSearchParams ? input.get(key) ?? undefined : firstValue(input[key]);
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function normalizeDisciplineAdminQuery(input: DisciplineAdminSearchParams): DisciplineAdminQuery {
  const statusValue = readParam(input, "status");
  const sortValue = readParam(input, "sort");
  const status: DisciplineAdminStatus = DISCIPLINE_STATUSES.includes(statusValue as DisciplineAdminStatus)
    ? statusValue as DisciplineAdminStatus
    : DISCIPLINE_ADMIN_DEFAULTS.status;
  const sort: DisciplineAdminSort = sortValue === "newest"
    ? sortValue
    : DISCIPLINE_ADMIN_DEFAULTS.sort;
  return {
    q: readParam(input, "q")?.trim() || undefined,
    status,
    sort,
    page: positivePage(readParam(input, "page")),
    pageSize: DISCIPLINE_ADMIN_PAGE_SIZE,
  };
}

export async function getSeasonSanctionsAdminReadModel(
  seasonId: string,
  query: DisciplineAdminQuery,
): Promise<DisciplineAdminResult> {
  const rows = await db
    .select()
    .from(disciplinaryCases)
    .where(eq(disciplinaryCases.seasonId, seasonId))
    .orderBy(asc(disciplinaryCases.createdAt), asc(disciplinaryCases.id));
  const subjectIds = [...new Set(rows.map((row) => row.subjectUserId))];
  const subjectRows = subjectIds.length === 0
    ? []
    : await db
        .select({
          id: users.id,
          displayName: users.displayName,
          perfectName: users.perfectName,
          steamName: users.steamName,
          email: users.email,
        })
        .from(users)
        .where(and(inArray(users.id, subjectIds), eq(users.status, "active")));
  const subjectById = new Map(subjectRows.map((row) => [row.id, row]));
  const now = new Date();
  const projected = rows.filter((row) => subjectById.has(row.subjectUserId)).map<DisciplineSanctionRow>((row) => {
    const subject = subjectById.get(row.subjectUserId);
    return {
      id: row.id,
      subjectUserId: row.subjectUserId,
      subjectLabel: subject ? getDisplayName(subject) : row.subjectUserId,
      storedStatus: row.status,
      resolvedStatus: resolveSanctionStatus(row, now),
      effects: [...(row.effects ?? [])],
      internalEvidence: row.internalEvidence,
      publicExplanation: row.publicExplanation,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveUntil: row.effectiveUntil?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revocationReason: row.revocationReason,
      createdAt: row.createdAt.toISOString(),
    };
  });
  const subjectSearchText = new Map(subjectRows.map((row) => [
    row.id,
    [row.displayName, row.perfectName, row.steamName, row.email].filter(Boolean).join(" ").toLocaleLowerCase(),
  ]));
  const q = query.q?.toLocaleLowerCase();
  const filtered = projected
    .filter((row) => query.status === "all" || row.resolvedStatus === query.status)
    .filter((row) => !q || (subjectSearchText.get(row.subjectUserId) ?? "").includes(q))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const total = filtered.length;
  const totalPages = Math.ceil(total / DISCIPLINE_ADMIN_PAGE_SIZE);
  const page = totalPages > 0 ? Math.min(query.page, totalPages) : 1;
  const start = (page - 1) * DISCIPLINE_ADMIN_PAGE_SIZE;

  return {
    rows: filtered.slice(start, start + DISCIPLINE_ADMIN_PAGE_SIZE),
    total,
    page,
    pageSize: DISCIPLINE_ADMIN_PAGE_SIZE,
    totalPages,
    normalizedQuery: { ...query, page },
    hasAnyRecords: projected.length > 0,
  };
}
