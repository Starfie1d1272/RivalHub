import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { escapeLikePattern } from "@/lib/db/search";
import { normalizeSteamProfileUrl } from "@/lib/external-url";
import {
  ADMIN_USERS_DEFAULTS,
  ADMIN_USERS_PAGE_SIZE,
  type AdminUserActivityFilter,
  type AdminUserEducationFilter,
  type AdminUserParticipationFilter,
  type AdminUserTeamFilter,
} from "./users-contract";

const USER_FILTERS = ["all", "participated", "none"] as const satisfies readonly AdminUserParticipationFilter[];
const EDUCATION_FILTERS = ["all", "approved", "unverified"] as const satisfies readonly AdminUserEducationFilter[];
const TEAM_FILTERS = ["all", "in_team", "none"] as const satisfies readonly AdminUserTeamFilter[];
const ACTIVITY_FILTERS = ["all", "24h", "7d", "30d"] as const satisfies readonly AdminUserActivityFilter[];

export type AdminUsersSearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

export interface AdminUsersQuery {
  q?: string;
  filter: AdminUserParticipationFilter;
  education: AdminUserEducationFilter;
  team: AdminUserTeamFilter;
  activity: AdminUserActivityFilter;
  page: number;
  pageSize: typeof ADMIN_USERS_PAGE_SIZE;
}

export interface AdminUserListRow {
  id: string;
  email: string;
  display_name: string | null;
  perfect_name: string | null;
  persona_name: string | null;
  steam64: string | null;
  steam_profile_url: string | null;
  qq: string | null;
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

function normalizeAdminUserRows(rows: unknown[]): AdminUserListRow[] {
  return (rows as AdminUserListRow[]).map((row) => ({
    ...row,
    steam_profile_url: normalizeSteamProfileUrl(row.steam_profile_url),
  }));
}

export function normalizeAdminUsersQuery(input: AdminUsersSearchParams): AdminUsersQuery {
  const rawFilter = readParam(input, "filter");
  const rawEducation = readParam(input, "education");
  const rawTeam = readParam(input, "team");
  const rawActivity = readParam(input, "activity");
  return {
    q: readParam(input, "q")?.trim() || undefined,
    filter: USER_FILTERS.includes(rawFilter as AdminUserParticipationFilter) ? rawFilter as AdminUserParticipationFilter : ADMIN_USERS_DEFAULTS.filter,
    education: EDUCATION_FILTERS.includes(rawEducation as AdminUserEducationFilter) ? rawEducation as AdminUserEducationFilter : ADMIN_USERS_DEFAULTS.education,
    team: TEAM_FILTERS.includes(rawTeam as AdminUserTeamFilter) ? rawTeam as AdminUserTeamFilter : ADMIN_USERS_DEFAULTS.team,
    activity: ACTIVITY_FILTERS.includes(rawActivity as AdminUserActivityFilter) ? rawActivity as AdminUserActivityFilter : ADMIN_USERS_DEFAULTS.activity,
    page: positivePage(readParam(input, "page")),
    pageSize: ADMIN_USERS_PAGE_SIZE,
  };
}

export async function getAdminUsersList(query: AdminUsersQuery): Promise<AdminUsersResult> {
  const searchValue = query.q ? escapeLikePattern(query.q) : null;
  const steam64Search = query.q && /^\d{17}$/.test(query.q)
    ? sql`OR u.steam64 = ${query.q}`
    : sql`OR u.steam64 ILIKE ${searchValue ? `%${searchValue}%` : ""}`;
  const searchClause = query.q
    ? sql`AND (
        u.email ILIKE ${`%${searchValue}%`}
        OR u.display_name ILIKE ${`%${searchValue}%`}
        OR u.perfect_name ILIKE ${`%${searchValue}%`}
        OR sp.persona_name ILIKE ${`%${searchValue}%`}
        ${steam64Search}
      )`
    : sql``;
  const havingClause = query.filter === "participated"
    ? sql`HAVING COUNT(DISTINCT sr.season_id) > 0`
    : query.filter === "none"
      ? sql`HAVING COUNT(DISTINCT sr.season_id) = 0`
      : sql``;
  const educationClause = query.education === "approved"
    ? sql`AND EXISTS (
        SELECT 1
        FROM education_verifications ev
        WHERE ev.user_id = u.id AND ev.status = 'approved'
      )`
    : query.education === "unverified"
      ? sql`AND NOT EXISTS (
          SELECT 1
          FROM education_verifications ev
          WHERE ev.user_id = u.id AND ev.status = 'approved'
        )`
      : sql``;
  const teamClause = query.team === "in_team"
    ? sql`AND EXISTS (
        SELECT 1
        FROM team_memberships tm
        INNER JOIN teams t ON t.id = tm.team_id
        WHERE tm.user_id = u.id AND tm.ended_at IS NULL AND t.status = 'active'
      )`
    : query.team === "none"
      ? sql`AND NOT EXISTS (
          SELECT 1
          FROM team_memberships tm
          INNER JOIN teams t ON t.id = tm.team_id
          WHERE tm.user_id = u.id AND tm.ended_at IS NULL AND t.status = 'active'
        )`
      : sql``;
  const activityClause = query.activity === "all"
    ? sql``
    : sql`AND EXISTS (
        SELECT 1
        FROM user_sessions us
        WHERE us.user_id = u.id
          AND us.last_active_at >= NOW() - ${query.activity === "24h" ? sql`INTERVAL '24 hours'` : query.activity === "7d" ? sql`INTERVAL '7 days'` : sql`INTERVAL '30 days'`}
      )`;
  const groupedUsers = sql`
    SELECT
      u.id,
      u.email,
      u.display_name,
      u.perfect_name,
      sp.persona_name,
      sp.profile_url AS steam_profile_url,
      u.steam64,
      u.qq,
      u.created_at,
      COUNT(DISTINCT sr.season_id)::int AS season_count
    FROM users u
    LEFT JOIN season_registrations sr ON sr.user_id = u.id
    LEFT JOIN steam_profiles sp ON sp.steam64 = u.steam64
      WHERE u.status = 'active'
      ${searchClause}
      ${educationClause}
      ${teamClause}
      ${activityClause}
    GROUP BY u.id, sp.persona_name, sp.profile_url
    ${havingClause}
  `;

  const [countResult, datasetResult, rowsResult] = await Promise.all([
    db.execute(sql`WITH user_rows AS (${groupedUsers}) SELECT COUNT(*)::int AS total FROM user_rows`),
    db.execute(sql`SELECT COUNT(*)::int AS total FROM users WHERE status = 'active'`),
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
    ? normalizeAdminUserRows(rowsResult.rows)
    : normalizeAdminUserRows((await db.execute(sql`
        WITH user_rows AS (${groupedUsers})
        SELECT *
        FROM user_rows
        ORDER BY created_at DESC, id DESC
        LIMIT ${ADMIN_USERS_PAGE_SIZE}
        OFFSET ${(page - 1) * ADMIN_USERS_PAGE_SIZE}
      `)).rows);

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
      WHERE u.status = 'active'
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
