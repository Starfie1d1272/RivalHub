import "server-only";

import { and, asc, count, countDistinct, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { educationVerifications, institutions, users } from "@/db/schema";
import { escapeLikePattern } from "@/lib/db/search";
import { getDisplayName } from "@/lib/identity/display-name";
import {
  EDUCATION_REVIEW_DEFAULTS,
  EDUCATION_REVIEW_PAGE_SIZE,
  type EducationReviewAcademic,
  type EducationReviewFilterStatus,
  type EducationReviewQuery,
  type EducationReviewQueue,
  type EducationReviewSearchParams,
  type EducationReviewSort,
} from "./admin-review-contract";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readParam(input: EducationReviewSearchParams, key: string): string | undefined {
  return input instanceof URLSearchParams ? input.get(key) ?? undefined : firstValue(input[key]);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function normalizeEducationReviewQuery(input: EducationReviewSearchParams): EducationReviewQuery {
  const q = readParam(input, "q")?.trim() || undefined;
  const statusValue = readParam(input, "status");
  const academicValue = readParam(input, "academic");
  const sortValue = readParam(input, "sort");
  const institutionValue = readParam(input, "institution");

  const status: EducationReviewFilterStatus = statusValue === "pending" || statusValue === "approved" || statusValue === "rejected" || statusValue === "all"
    ? statusValue
    : EDUCATION_REVIEW_DEFAULTS.status;
  const academic: EducationReviewAcademic = academicValue === "all" || academicValue === "enrolled" || academicValue === "graduated"
    ? academicValue
    : EDUCATION_REVIEW_DEFAULTS.academic;
  const sort: EducationReviewSort = sortValue === "oldest" || sortValue === "newest" || sortValue === "recently_reviewed"
    ? sortValue
    : EDUCATION_REVIEW_DEFAULTS.sort;

  return {
    q,
    status,
    institution: institutionValue && isUuid(institutionValue) ? institutionValue : undefined,
    academic,
    sort,
    page: positivePage(readParam(input, "page")),
    pageSize: EDUCATION_REVIEW_PAGE_SIZE,
  };
}

export async function getEducationReviewQueue(query: EducationReviewQuery): Promise<EducationReviewQueue> {
  const conditions = [eq(users.status, "active")];
  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    conditions.push(or(
      ilike(users.displayName, pattern),
      ilike(users.perfectName, pattern),
      ilike(users.steamName, pattern),
      ilike(users.email, pattern),
      ilike(institutions.name, pattern),
      ilike(educationVerifications.evidenceCode, pattern),
    )!);
  }
  if (query.status !== "all") conditions.push(eq(educationVerifications.status, query.status));
  if (query.institution) conditions.push(eq(educationVerifications.institutionId, query.institution));
  if (query.academic !== "all") conditions.push(eq(educationVerifications.academicStatus, query.academic));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [[totalRow], institutionOptionRows, [datasetRow], [activeUserRow], approvedIdentityRows] = await Promise.all([
    db.select({ count: count() })
      .from(educationVerifications)
      .innerJoin(users, eq(educationVerifications.userId, users.id))
      .innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
      .where(where),
    db.select({ id: institutions.id, name: institutions.name, userCount: countDistinct(users.id) })
      .from(educationVerifications)
      .innerJoin(users, and(eq(educationVerifications.userId, users.id), eq(users.status, "active")))
      .innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
      .groupBy(institutions.id, institutions.name)
      .orderBy(desc(countDistinct(users.id)), asc(institutions.name), asc(institutions.id)),
    db.select({ count: count() }).from(educationVerifications).innerJoin(users, and(eq(educationVerifications.userId, users.id), eq(users.status, "active"))),
    db.select({ count: count() }).from(users).where(eq(users.status, "active")),
    db.selectDistinctOn([educationVerifications.userId, educationVerifications.institutionId], {
      userId: educationVerifications.userId,
      institutionId: educationVerifications.institutionId,
      institutionName: institutions.name,
      academicStatus: educationVerifications.academicStatus,
      submittedAt: educationVerifications.submittedAt,
      id: educationVerifications.id,
    })
      .from(educationVerifications)
      .innerJoin(users, and(eq(educationVerifications.userId, users.id), eq(users.status, "active")))
      .innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
      .where(eq(educationVerifications.status, "approved"))
      .orderBy(educationVerifications.userId, educationVerifications.institutionId, desc(educationVerifications.submittedAt), desc(educationVerifications.id)),
  ]);

  const total = Number(totalRow?.count ?? 0);
  const totalPages = Math.ceil(total / EDUCATION_REVIEW_PAGE_SIZE);
  const page = totalPages > 0 ? Math.min(query.page, totalPages) : 1;
  const orderBy = query.sort === "oldest"
    ? [asc(educationVerifications.submittedAt), asc(educationVerifications.id)]
    : query.sort === "newest"
      ? [desc(educationVerifications.submittedAt), desc(educationVerifications.id)]
      : [sql`${educationVerifications.reviewedAt} DESC NULLS LAST`, desc(educationVerifications.submittedAt), desc(educationVerifications.id)];

  const rows = await db.select({
    id: educationVerifications.id,
    email: users.email,
    displayName: users.displayName,
    perfectName: users.perfectName,
    steamName: users.steamName,
    institution: institutions.name,
    code: institutions.moeInstitutionCode,
    academicStatus: educationVerifications.academicStatus,
    evidenceType: educationVerifications.evidenceType,
    evidenceCode: educationVerifications.evidenceCode,
    status: educationVerifications.status,
    submittedAt: educationVerifications.submittedAt,
    reviewNote: educationVerifications.reviewNote,
  })
    .from(educationVerifications)
    .innerJoin(users, eq(educationVerifications.userId, users.id))
    .innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(EDUCATION_REVIEW_PAGE_SIZE)
    .offset((page - 1) * EDUCATION_REVIEW_PAGE_SIZE);

  return {
    rows: rows.map(({ perfectName, steamName, ...row }) => ({
      ...row,
      displayName: getDisplayName({ ...row, perfectName, steamName }),
      submittedAt: row.submittedAt.toISOString(),
    })),
    total,
    page,
    pageSize: EDUCATION_REVIEW_PAGE_SIZE,
    totalPages,
    institutionOptions: institutionOptionRows.map((row) => ({ ...row, userCount: Number(row.userCount) })),
    overview: buildEducationOverview(Number(activeUserRow?.count ?? 0), approvedIdentityRows),
    normalizedQuery: { ...query, page },
    hasAnyRecords: Number(datasetRow?.count ?? 0) > 0,
  };
}

function buildEducationOverview(
  activeUserCount: number,
  identities: Array<{ userId: string; institutionId: string; institutionName: string; academicStatus: "enrolled" | "graduated" }>,
): EducationReviewQueue["overview"] {
  const institutionCounts = new Map<string, { id: string; name: string; identityCount: number }>();
  const academicDistribution = { enrolled: 0, graduated: 0 };
  for (const identity of identities) {
    const current = institutionCounts.get(identity.institutionId);
    institutionCounts.set(identity.institutionId, {
      id: identity.institutionId,
      name: identity.institutionName,
      identityCount: (current?.identityCount ?? 0) + 1,
    });
    academicDistribution[identity.academicStatus] += 1;
  }

  return {
    activeUserCount,
    approvedUserCount: new Set(identities.map((identity) => identity.userId)).size,
    institutionDistribution: [...institutionCounts.values()].sort((left, right) =>
      right.identityCount - left.identityCount || left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id),
    ),
    academicDistribution,
  };
}
