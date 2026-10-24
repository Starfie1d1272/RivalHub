import "server-only";

import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { adminInviteClaims, adminInvites, seasons } from "@/db/schema";
import {
  ADMIN_INVITE_DEFAULTS,
  ADMIN_INVITE_PAGE_SIZE,
  type AdminInviteHistoryResult,
  type AdminInviteQuery,
  type AdminInviteSearchParams,
  type AdminInviteState,
  type AdminInviteSort,
  type AdminInviteRoleFilter,
} from "./invites-contract";

const INVITE_ROLES = ["season_admin", "super_admin"] as const;
const INVITE_STATES = ["usable", "expired", "revoked", "exhausted"] as const;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readParam(input: AdminInviteSearchParams, key: string): string | undefined {
  return input instanceof URLSearchParams ? input.get(key) ?? undefined : firstValue(input[key]);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function normalizeAdminInviteQuery(input: AdminInviteSearchParams): AdminInviteQuery {
  const roleValue = readParam(input, "role");
  const stateValue = readParam(input, "state");
  const sortValue = readParam(input, "sort");
  const seasonValue = readParam(input, "season");
  const role: AdminInviteRoleFilter = roleValue === "all" || INVITE_ROLES.includes(roleValue as typeof INVITE_ROLES[number])
    ? roleValue as AdminInviteRoleFilter
    : ADMIN_INVITE_DEFAULTS.role;
  const state: AdminInviteState = stateValue === "all" || INVITE_STATES.includes(stateValue as typeof INVITE_STATES[number])
    ? stateValue as AdminInviteState
    : ADMIN_INVITE_DEFAULTS.state;
  const sort: AdminInviteSort = sortValue === "oldest" || sortValue === "expires_soon" || sortValue === "newest"
    ? sortValue
    : ADMIN_INVITE_DEFAULTS.sort;

  return {
    role,
    state,
    season: seasonValue && isUuid(seasonValue) ? seasonValue : undefined,
    sort,
    page: positivePage(readParam(input, "page")),
    pageSize: ADMIN_INVITE_PAGE_SIZE,
  };
}

export function resolveAdminInviteState(
  row: { isActive: boolean; expiresAt: Date | null; maxUses: number; claimCount: number },
  now: Date,
): Exclude<AdminInviteState, "all"> {
  if (!row.isActive) return "revoked";
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.claimCount >= row.maxUses) return "exhausted";
  return "usable";
}

export async function getAdminInviteHistory(query: AdminInviteQuery, now = new Date()): Promise<AdminInviteHistoryResult> {
  const claims = db.select({ inviteId: adminInviteClaims.inviteId, count: count(adminInviteClaims.userId).as("claim_count") })
    .from(adminInviteClaims).groupBy(adminInviteClaims.inviteId).as("claims");
  const claimCount = sql<number>`coalesce(${claims.count}, 0)`;
  // Same precedence as resolveAdminInviteState, evaluated before pagination using one clock.
  const state = sql<Exclude<AdminInviteState, "all">>`case
    when not ${adminInvites.isActive} then 'revoked'
    when ${adminInvites.expiresAt} <= ${now} then 'expired'
    when ${claimCount} >= ${adminInvites.maxUses} then 'exhausted'
    else 'usable' end`;
  const conditions = [];
  if (query.role !== "all") conditions.push(eq(adminInvites.role, query.role));
  if (query.season) conditions.push(eq(adminInvites.seasonId, query.season));
  if (query.state !== "all") conditions.push(eq(state, query.state));
  const where = and(...conditions);
  const order = query.sort === "expires_soon"
    ? [sql`${adminInvites.expiresAt} asc nulls last`, desc(adminInvites.createdAt), desc(adminInvites.id)]
    : [query.sort === "oldest" ? asc(adminInvites.createdAt) : desc(adminInvites.createdAt), desc(adminInvites.id)];
  const readPage = (page: number) => db.select({
    id: adminInvites.id, code: adminInvites.code, role: adminInvites.role, seasonId: adminInvites.seasonId,
    seasonName: seasons.name, maxUses: adminInvites.maxUses, claimCount, state,
    expiresAt: adminInvites.expiresAt, createdAt: adminInvites.createdAt,
  }).from(adminInvites).leftJoin(claims, eq(claims.inviteId, adminInvites.id))
    .leftJoin(seasons, eq(seasons.id, adminInvites.seasonId)).where(where).orderBy(...order)
    .limit(ADMIN_INVITE_PAGE_SIZE).offset((page - 1) * ADMIN_INVITE_PAGE_SIZE);
  const [[totalRow], initialRows] = await Promise.all([
    db.select({ count: count(), datasetCount: sql<number>`(select count(*) from ${adminInvites})` })
      .from(adminInvites).leftJoin(claims, eq(claims.inviteId, adminInvites.id)).where(where),
    readPage(query.page),
  ]);
  const total = Number(totalRow?.count ?? 0);
  const totalPages = Math.ceil(total / ADMIN_INVITE_PAGE_SIZE);
  const page = totalPages > 0 ? Math.min(query.page, totalPages) : 1;
  const rows = page === query.page ? initialRows : await readPage(page);
  return { rows: rows.map(row => ({ ...row, claimCount: Number(row.claimCount),
    expiresAt: row.expiresAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })),
    total, page, pageSize: ADMIN_INVITE_PAGE_SIZE, totalPages, normalizedQuery: { ...query, page },
    hasAnyRecords: Number(totalRow?.datasetCount ?? 0) > 0 };
}
