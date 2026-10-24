import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { disciplinaryCases, steamProfiles, users } from "@/db/schema";
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
  now = new Date(),
): Promise<DisciplineAdminResult> {
  return db.transaction(async tx => {
    // Keep status/search resolution in the canonical JS owners. Only narrow facts
    // and subject labels enter the all-case pass; long evidence is read for the
    // selected page after filtering and stable ordering.
    const rows = await tx.select({
      id: disciplinaryCases.id, subjectUserId: disciplinaryCases.subjectUserId,
      status: disciplinaryCases.status, effectiveFrom: disciplinaryCases.effectiveFrom,
      effectiveUntil: disciplinaryCases.effectiveUntil, createdAt: disciplinaryCases.createdAt,
      displayName: users.displayName, perfectName: users.perfectName,
      personaName: steamProfiles.personaName, email: users.email,
    }).from(disciplinaryCases)
      .innerJoin(users, and(eq(users.id, disciplinaryCases.subjectUserId), eq(users.status, "active")))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(eq(disciplinaryCases.seasonId, seasonId));
    const q = query.q?.toLocaleLowerCase();
    const filtered = rows
      .filter(row => query.status === "all" || resolveSanctionStatus(row, now) === query.status)
      .filter(row => !q || [row.displayName, row.perfectName, row.personaName, row.email]
        .filter(Boolean).join(" ").toLocaleLowerCase().includes(q))
      .sort((left, right) => right.createdAt.toISOString().localeCompare(left.createdAt.toISOString()) || right.id.localeCompare(left.id));
    const total = filtered.length;
    const totalPages = Math.ceil(total / DISCIPLINE_ADMIN_PAGE_SIZE);
    const page = totalPages > 0 ? Math.min(query.page, totalPages) : 1;
    const start = (page - 1) * DISCIPLINE_ADMIN_PAGE_SIZE;

    const pageFacts = filtered.slice(start, start + DISCIPLINE_ADMIN_PAGE_SIZE);
    const details = pageFacts.length ? await tx.select().from(disciplinaryCases)
      .where(and(eq(disciplinaryCases.seasonId, seasonId), inArray(disciplinaryCases.id, pageFacts.map(row => row.id)))) : [];
    const detailsById = new Map(details.map(row => [row.id, row]));
    const projected = pageFacts.flatMap<DisciplineSanctionRow>(subject => {
      const row = detailsById.get(subject.id);
      if (!row) return [];
      return [{
        id: row.id, subjectUserId: row.subjectUserId, subjectLabel: getDisplayName(subject),
        storedStatus: subject.status, resolvedStatus: resolveSanctionStatus(subject, now),
        effects: [...(row.effects ?? [])], internalEvidence: row.internalEvidence,
        publicExplanation: row.publicExplanation, effectiveFrom: subject.effectiveFrom.toISOString(),
        effectiveUntil: subject.effectiveUntil?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null, revocationReason: row.revocationReason,
        createdAt: subject.createdAt.toISOString(),
      }];
    });

    return {
      rows: projected,
      total,
      page,
      pageSize: DISCIPLINE_ADMIN_PAGE_SIZE,
      totalPages,
      normalizedQuery: { ...query, page },
      hasAnyRecords: rows.length > 0,
    };
  }, { accessMode: "read only", isolationLevel: "repeatable read" });
}
