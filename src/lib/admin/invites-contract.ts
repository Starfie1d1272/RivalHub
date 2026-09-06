export const ADMIN_INVITE_PAGE_SIZE = 25;

export const ADMIN_INVITE_DEFAULTS = {
  role: "all",
  state: "all",
  season: "",
  sort: "newest",
} as const;

export type AdminInviteSearchParams = Record<string, string | string[] | undefined> | URLSearchParams;
export type AdminInviteRoleFilter = "all" | "season_admin" | "super_admin";
export type AdminInviteState = "all" | "usable" | "expired" | "revoked" | "exhausted";
export type AdminInviteSort = "newest" | "oldest" | "expires_soon";

export interface AdminInviteQuery {
  role: AdminInviteRoleFilter;
  state: AdminInviteState;
  season?: string;
  sort: AdminInviteSort;
  page: number;
  pageSize: typeof ADMIN_INVITE_PAGE_SIZE;
}

export interface AdminInviteHistoryRow {
  id: string;
  code: string;
  role: "super_admin" | "season_admin";
  seasonId: string | null;
  seasonName: string | null;
  maxUses: number;
  claimCount: number;
  state: Exclude<AdminInviteState, "all">;
  expiresAt: string | null;
  createdAt: string;
}

export interface AdminInviteHistoryResult {
  rows: AdminInviteHistoryRow[];
  total: number;
  page: number;
  pageSize: typeof ADMIN_INVITE_PAGE_SIZE;
  totalPages: number;
  normalizedQuery: AdminInviteQuery;
  hasAnyRecords: boolean;
}

export interface AdminInviteSeasonOption {
  id: string;
  name: string;
  slug: string;
}
