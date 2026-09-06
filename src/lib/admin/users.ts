import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { escapeLikePattern } from "@/lib/db/search";
import { ADMIN_USERS_DEFAULTS, ADMIN_USERS_PAGE_SIZE } from "./users-contract";

const USER_FILTERS = ["all", "participated", "none"] as const;
type AdminUserFilter = (typeof USER_FILTERS)[number];

export type AdminUsersSearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

export interface AdminUsersQuery {
  q?: string;
  filter: AdminUserFilter;
  page: number;
  pageSize: typeof ADMIN_USERS_PAGE_SIZE;
}

export interface AdminUserListRow {
  id: string;
  email: string;
  display_name: string | null;
  perfect_name: string | null;
  steam_name: string | null;
  created_at: string | Date;
  season_count: number | string;
}

export interface AdminUsersResult {
  rows: AdminUserListRow[];
  total: number;
  page: number;
  pageSize: typeof ADMIN_USERS_PAGE_SIZE;
  totalPages: number;
  normalizedQuery: AdminUsersQuery;
  hasAnyRecords: boolean;
}

export interface AdminUserStats {
  total: number;
  participated: number;
  notParticipated: number;
  recent30d: number;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readParam(input: AdminUsersSearchParams, key: string): string | undefined {
  return input instanceof URLSearchParams ? input.get(key) ?? undefined : firstValue(input[key]);
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeAdminUsersQuery(input: AdminUsersSearchParams): AdminUsersQuery {
  const rawFilter = readParam(input, "filter");
  return {
    q: readParam(input, "q")?.trim() || undefined,
    filter: USER_FILTERS.includes(rawFilter as AdminUserFilter) ? rawFilter as AdminUserFilter : ADMIN_USERS_DEFAULTS.filter,
    page: positivePage(readParam(input, "page")),
    pageSize: ADMIN_USERS_PAGE_SIZE,
  };
}

export async function getAdminUsersList(query: AdminUsersQuery): Promise<AdminUsersResult> {
  const searchClause = query.q
    ? sql`AND (
        u.email ILIKE ${`%${escapeLikePattern(query.q)}%`}
        OR u.display_name ILIKE ${`%${escapeLikePattern(query.q)}%`}
        OR u.perfect_name ILIKE ${`%${escapeLikePattern(query.q)}%`}
        OR u.steam_name ILIKE ${`%${escapeLikePattern(query.q)}%`}
      )`
    : sql``;
  const havingClause = query.filter === "participated"
    ? sql`HAVING COUNT(DISTINCT sr.season_id) > 0`
    : query.filter === "none"
      ? sql`HAVING COUNT(DISTINCT sr.season_id) = 0`
      : sql``;
  const groupedUsers = sql`
    SELECT
      u.id,
      u.email,
      u.display_name,
      u.perfect_name,
      u.steam_name,
      u.created_at,
      COUNT(DISTINCT sr.season_id)::int AS season_count
    FROM users u
    LEFT JOIN season_registrations sr ON sr.user_id = u.id
    WHERE u.role = 'user'
      ${searchClause}
    GROUP BY u.id
    ${havingClause}
  `;

  const [countResult, datasetResult, rowsResult] = await Promise.all([
    db.execute(sql`WITH user_rows AS (${groupedUsers}) SELECT COUNT(*)::int AS total FROM user_rows`),
    db.execute(sql`SELECT COUNT(*)::int AS total FROM users WHERE role = 'user'`),
    db.execute(sql`
      WITH user_rows AS (${groupedUsers})
      SELECT *
      FROM user_rows
      ORDER BY created_at DESC, id DESC
      LIMIT ${ADMIN_USERS_PAGE_SIZE}
      OFFSET ${(query.page - 1) * ADMIN_USERS_PAGE_SIZE}
    `),
  ]);

  const total = integer((countResult.rows[0] as { total?: unknown } | undefined)?.total);
  const totalPages = Math.ceil(total / ADMIN_USERS_PAGE_SIZE);
  const page = totalPages > 0 ? Math.min(query.page, totalPages) : 1;
  const rows = page === query.page
    ? rowsResult.rows as unknown as AdminUserListRow[]
    : (await db.execute(sql`
        WITH user_rows AS (${groupedUsers})
        SELECT *
        FROM user_rows
        ORDER BY created_at DESC, id DESC
        LIMIT ${ADMIN_USERS_PAGE_SIZE}
        OFFSET ${(page - 1) * ADMIN_USERS_PAGE_SIZE}
      `)).rows as unknown as AdminUserListRow[];

  return {
    rows,
    total,
    page,
    pageSize: ADMIN_USERS_PAGE_SIZE,
    totalPages,
    normalizedQuery: { ...query, page },
    hasAnyRecords: integer((datasetResult.rows[0] as { total?: unknown } | undefined)?.total) > 0,
  };
}

export async function getAdminUserStats(): Promise<AdminUserStats> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE season_count > 0)::int AS participated,
      COUNT(*) FILTER (WHERE season_count = 0)::int AS not_participated,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS recent_30d
    FROM (
      SELECT u.id, u.created_at, COUNT(DISTINCT sr.season_id) AS season_count
      FROM users u
      LEFT JOIN season_registrations sr ON sr.user_id = u.id
      GROUP BY u.id, u.created_at
    ) sub
  `);
  const row = result.rows[0] as {
    total?: unknown;
    participated?: unknown;
    not_participated?: unknown;
    recent_30d?: unknown;
  } | undefined;
  return {
    total: integer(row?.total),
    participated: integer(row?.participated),
    notParticipated: integer(row?.not_participated),
    recent30d: integer(row?.recent_30d),
  };
}
