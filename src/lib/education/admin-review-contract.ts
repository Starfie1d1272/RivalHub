import type { AcademicStatus, EducationVerificationStatus } from "./presentation";

export const EDUCATION_REVIEW_PAGE_SIZE = 25;

export const EDUCATION_REVIEW_DEFAULTS = {
  q: "",
  status: "pending",
  institution: "",
  academic: "all",
  sort: "oldest",
} as const;

export type EducationReviewFilterStatus = EducationVerificationStatus | "all";
export type EducationReviewAcademic = AcademicStatus | "all";
export type EducationReviewSort = "oldest" | "newest" | "recently_reviewed";
export type EducationEvidenceLabel = "学信网学籍在线验证报告" | "学信网学历材料" | "学校邮箱" | "录取通知书材料";

export interface EducationReviewQuery {
  q?: string;
  status: EducationReviewFilterStatus;
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
  academicStatus: AcademicStatus;
  evidenceLabel: EducationEvidenceLabel;
  chsiEvidenceCode: string | null;
  manualEvidenceAvailable: boolean;
  status: EducationVerificationStatus;
  submittedAt: string;
  reviewNote: string | null;
}

export interface EducationReviewQueue {
  rows: EducationReviewRow[];
  total: number;
  page: number;
  pageSize: typeof EDUCATION_REVIEW_PAGE_SIZE;
  totalPages: number;
  institutionOptions: { id: string; name: string; userCount: number }[];
  overview: {
    activeUserCount: number;
    approvedUserCount: number;
    institutionDistribution: { id: string; name: string; identityCount: number }[];
    academicDistribution: { enrolled: number; graduated: number };
  };
  normalizedQuery: EducationReviewQuery;
  hasAnyRecords: boolean;
}
