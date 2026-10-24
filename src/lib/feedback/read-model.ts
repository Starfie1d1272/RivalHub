import "server-only";

import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { feedbackReports, seasons, steamProfiles, users } from "@/db/schema";
import { feedbackCategoryLabel, feedbackStatusLabel, type FeedbackCategory, type FeedbackStatus } from "./validation";
import { getFeedbackUserLabel } from "./presentation";

export type FeedbackAdminRow = {
  id: string;
  category: FeedbackCategory;
  categoryLabel: string;
  body: string;
  pathname: string;
  releaseVersion: string;
  status: FeedbackStatus;
  statusLabel: string;
  seasonId: string | null;
  seasonName: string | null;
  userId: string | null;
  userLabel: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FeedbackAdminSummary = Omit<FeedbackAdminRow, "body"> & { bodySummary: string };
const FEEDBACK_ADMIN_PAGE_SIZE = 25;
type Filters = { status?: FeedbackStatus; category?: FeedbackCategory };

function feedbackFilter(filters: Filters) {
  return and(filters.status ? eq(feedbackReports.status, filters.status) : undefined,
    filters.category ? eq(feedbackReports.category, filters.category) : undefined);
}

function feedbackQuery(where: SQL | undefined, summary = false) {
  return db.select({
    id: feedbackReports.id, category: feedbackReports.category,
    body: summary ? sql<string>`left(${feedbackReports.body}, 160)` : feedbackReports.body,
    pathname: feedbackReports.pathname, releaseVersion: feedbackReports.releaseVersion, status: feedbackReports.status,
    seasonId: feedbackReports.seasonId, seasonName: seasons.name,
    userId: feedbackReports.userId, userEmail: users.email, userDisplayName: users.displayName,
    userPerfectName: users.perfectName, userSteamName: steamProfiles.personaName,
    createdAt: feedbackReports.createdAt, updatedAt: feedbackReports.updatedAt,
  }).from(feedbackReports).leftJoin(seasons, eq(feedbackReports.seasonId, seasons.id))
    .leftJoin(users, eq(feedbackReports.userId, users.id))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(where)
    .orderBy(desc(feedbackReports.createdAt), desc(feedbackReports.id));
}

type FeedbackReadRow = Awaited<ReturnType<typeof feedbackQuery>>[number];
function projectFeedback(row: FeedbackReadRow): FeedbackAdminRow {
  return { id: row.id, category: row.category, categoryLabel: feedbackCategoryLabel(row.category), body: row.body,
    pathname: row.pathname, releaseVersion: row.releaseVersion, status: row.status, statusLabel: feedbackStatusLabel(row.status),
    seasonId: row.seasonId, seasonName: row.seasonName ?? null, userId: row.userId,
    userLabel: getFeedbackUserLabel({ userId: row.userId, displayName: row.userDisplayName, perfectName: row.userPerfectName,
      personaName: row.userSteamName, email: row.userEmail }),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function getFeedbackAdminPage(filters: Filters & { page?: number } = {}) {
  const requested = Number.isSafeInteger(filters.page) && filters.page! > 0 ? filters.page! : 1;
  const where = feedbackFilter(filters);
  const readPage = (page: number) => feedbackQuery(where, true).limit(FEEDBACK_ADMIN_PAGE_SIZE).offset((page - 1) * FEEDBACK_ADMIN_PAGE_SIZE);
  const [[totalRow], initialRows] = await Promise.all([
    db.select({ count: count() }).from(feedbackReports).where(where), readPage(requested),
  ]);
  const total = Number(totalRow?.count ?? 0);
  const totalPages = Math.ceil(total / FEEDBACK_ADMIN_PAGE_SIZE);
  const page = totalPages ? Math.min(requested, totalPages) : 1;
  const rows = (page === requested ? initialRows : await readPage(page)).map(projectFeedback).map(({ body, ...row }) => ({ ...row, bodySummary: body }));
  return { rows, total, page, pageSize: FEEDBACK_ADMIN_PAGE_SIZE, totalPages };
}

/** Callers must authorize each detail request; no list scan or private fingerprint escapes. */
export async function getFeedbackForAdmin(id: string): Promise<FeedbackAdminRow | null> {
  const [row] = await feedbackQuery(eq(feedbackReports.id, id)).limit(1);
  return row ? projectFeedback(row) : null;
}
