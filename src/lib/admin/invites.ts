import "server-only";

import { and, count, eq } from "drizzle-orm";
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

export async function getAdminInviteHistory(query: AdminInviteQuery): Promise<AdminInviteHistoryResult> {
  const conditions = [];
  if (query.role !== "all") conditions.push(eq(adminInvites.role, query.role));
  if (query.season) conditions.push(eq(adminInvites.seasonId, query.season));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [datasetCount]] = await Promise.all([
    db
      .select({
        id: adminInvites.id,
        code: adminInvites.code,
        role: adminInvites.role,
        seasonId: adminInvites.seasonId,
        seasonName: seasons.name,
        maxUses: adminInvites.maxUses,
        expiresAt: adminInvites.expiresAt,
        createdAt: adminInvites.createdAt,
        claimCount: count(adminInviteClaims.userId),
        isActive: adminInvites.isActive,
      })
      .from(adminInvites)
      .leftJoin(adminInviteClaims, eq(adminInviteClaims.inviteId, adminInvites.id))
      .leftJoin(seasons, eq(seasons.id, adminInvites.seasonId))
      .where(where)
      .groupBy(
        adminInvites.id,
        adminInvites.code,
        adminInvites.role,
        adminInvites.seasonId,
        seasons.name,
        adminInvites.maxUses,
        adminInvites.expiresAt,
        adminInvites.createdAt,
        adminInvites.isActive,
      ),
    db.select({ count: count() }).from(adminInvites),
  ]);

  const now = new Date();
  const projected = rows
    .map((row) => {
      const claimCount = Number(row.claimCount);
      return {
        id: row.id,
        code: row.code,
        role: row.role,
        seasonId: row.seasonId,
        seasonName: row.seasonName,
        maxUses: row.maxUses,
        claimCount,
        state: resolveAdminInviteState(row, now),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    })
    .filter((row) => query.state === "all" || row.state === query.state)
    .sort((left, right) => {
      if (query.sort === "expires_soon") {
        if (left.expiresAt === null && right.expiresAt !== null) return 1;
        if (left.expiresAt !== null && right.expiresAt === null) return -1;
        if (left.expiresAt !== null && right.expiresAt !== null) {
          const expiryOrder = left.expiresAt.localeCompare(right.expiresAt);
          if (expiryOrder !== 0) return expiryOrder;
        }
        const createdOrder = right.createdAt.localeCompare(left.createdAt);
        if (createdOrder !== 0) return createdOrder;
      } else if (query.sort === "oldest") {
        const createdOrder = left.createdAt.localeCompare(right.createdAt);
        if (createdOrder !== 0) return createdOrder;
      } else {
        const createdOrder = right.createdAt.localeCompare(left.createdAt);
        if (createdOrder !== 0) return createdOrder;
      }
      return right.id.localeCompare(left.id);
    });

  const total = projected.length;
  const totalPages = Math.ceil(total / ADMIN_INVITE_PAGE_SIZE);
  const page = totalPages > 0 ? Math.min(query.page, totalPages) : 1;
  const start = (page - 1) * ADMIN_INVITE_PAGE_SIZE;

  return {
    rows: projected.slice(start, start + ADMIN_INVITE_PAGE_SIZE),
    total,
    page,
    pageSize: ADMIN_INVITE_PAGE_SIZE,
    totalPages,
    normalizedQuery: { ...query, page },
    hasAnyRecords: Number(datasetCount?.count ?? 0) > 0,
  };
}
