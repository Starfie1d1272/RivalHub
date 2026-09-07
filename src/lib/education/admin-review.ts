import "server-only";

import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { educationVerifications, institutions, users } from "@/db/schema";
import { escapeLikePattern } from "@/lib/db/search";
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
      ilike(users.email, pattern),
      ilike(institutions.name, pattern),
      ilike(educationVerifications.evidenceCode, pattern),
    )!);
  }
  if (query.status !== "all") conditions.push(eq(educationVerifications.status, query.status));
  if (query.institution) conditions.push(eq(educationVerifications.institutionId, query.institution));
  if (query.academic !== "all") conditions.push(eq(educationVerifications.academicStatus, query.academic));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [[totalRow], institutionOptions, [datasetRow]] = await Promise.all([
    db.select({ count: count() })
      .from(educationVerifications)
      .innerJoin(users, eq(educationVerifications.userId, users.id))
      .innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
      .where(where),
    db.select({ id: institutions.id, name: institutions.name })
      .from(institutions)
      .orderBy(asc(institutions.name), asc(institutions.id)),
    db.select({ count: count() }).from(educationVerifications).innerJoin(users, and(eq(educationVerifications.userId, users.id), eq(users.status, "active"))),
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
    rows: rows.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() })),
    total,
    page,
    pageSize: EDUCATION_REVIEW_PAGE_SIZE,
    totalPages,
    institutionOptions,
    normalizedQuery: { ...query, page },
    hasAnyRecords: Number(datasetRow?.count ?? 0) > 0,
  };
}
