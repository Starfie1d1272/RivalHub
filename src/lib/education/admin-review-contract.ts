export const EDUCATION_REVIEW_PAGE_SIZE = 25;

export const EDUCATION_REVIEW_DEFAULTS = {
  q: "",
  status: "pending",
  institution: "",
  academic: "all",
  sort: "oldest",
} as const;

export type EducationReviewStatus = "pending" | "approved" | "rejected" | "all";
export type EducationReviewAcademic = "all" | "enrolled" | "graduated";
export type EducationReviewSort = "oldest" | "newest" | "recently_reviewed";

export interface EducationReviewQuery {
  q?: string;
  status: EducationReviewStatus;
  institution?: string;
  academic: EducationReviewAcademic;
  sort: EducationReviewSort;
  page: number;
  pageSize: typeof EDUCATION_REVIEW_PAGE_SIZE;
}

export type EducationReviewSearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

export interface EducationReviewRow {
  id: string;
  email: string;
  displayName: string | null;
  institution: string;
  code: string | null;
  academicStatus: "enrolled" | "graduated";
  evidenceType: string;
  evidenceCode: string | null;
  status: EducationReviewStatus;
  submittedAt: string;
  reviewNote: string | null;
}

export interface EducationReviewQueue {
  rows: EducationReviewRow[];
  total: number;
  page: number;
  pageSize: typeof EDUCATION_REVIEW_PAGE_SIZE;
  totalPages: number;
  institutionOptions: { id: string; name: string }[];
  normalizedQuery: EducationReviewQuery;
  hasAnyRecords: boolean;
}
