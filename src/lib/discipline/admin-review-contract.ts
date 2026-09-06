export const DISCIPLINE_ADMIN_PAGE_SIZE = 25;

export const DISCIPLINE_ADMIN_DEFAULTS = {
  q: "",
  status: "active",
  sort: "newest",
} as const;

export type DisciplineAdminSearchParams = Record<string, string | string[] | undefined> | URLSearchParams;
export type DisciplineAdminStatus = "all" | "active" | "draft" | "expired" | "revoked";
export type DisciplineAdminSort = "newest";
export type DisciplineStoredStatus = "draft" | "active" | "expired" | "revoked";
export type DisciplineResolvedStatus = Exclude<DisciplineAdminStatus, "all">;
export type DisciplineEffect = "registration_block" | "roster_block" | "match_participation_block";

export interface DisciplineAdminQuery {
  q?: string;
  status: DisciplineAdminStatus;
  sort: DisciplineAdminSort;
  page: number;
  pageSize: typeof DISCIPLINE_ADMIN_PAGE_SIZE;
}

export interface DisciplineSanctionRow {
  id: string;
  subjectUserId: string;
  subjectLabel: string;
  storedStatus: DisciplineStoredStatus;
  resolvedStatus: DisciplineResolvedStatus;
  effects: string[];
  internalEvidence: string | null;
  publicExplanation: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
}

export interface DisciplineAdminResult {
  rows: DisciplineSanctionRow[];
  total: number;
  page: number;
  pageSize: typeof DISCIPLINE_ADMIN_PAGE_SIZE;
  totalPages: number;
  normalizedQuery: DisciplineAdminQuery;
  hasAnyRecords: boolean;
}

export interface DisciplineSubjectOption {
  id: string;
  label: string;
  detail: string | null;
}
