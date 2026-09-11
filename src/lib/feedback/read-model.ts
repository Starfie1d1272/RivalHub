import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { feedbackReports, seasons, users } from "@/db/schema";
import { feedbackCategoryLabel, feedbackStatusLabel, type FeedbackCategory, type FeedbackStatus } from "./validation";

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

export async function listFeedbackForAdmin(filters: { status?: FeedbackStatus; category?: FeedbackCategory } = {}): Promise<FeedbackAdminRow[]> {
  const rows = await db.select({
    feedback: feedbackReports,
    seasonName: seasons.name,
    userEmail: users.email,
    userDisplayName: users.displayName,
  }).from(feedbackReports)
    .leftJoin(seasons, eq(feedbackReports.seasonId, seasons.id))
    .leftJoin(users, eq(feedbackReports.userId, users.id))
    .where(and(filters.status ? eq(feedbackReports.status, filters.status) : undefined, filters.category ? eq(feedbackReports.category, filters.category) : undefined))
    .orderBy(desc(feedbackReports.createdAt), desc(feedbackReports.id));
  return rows.map(({ feedback, seasonName, userEmail, userDisplayName }) => ({
    id: feedback.id,
    category: feedback.category,
    categoryLabel: feedbackCategoryLabel(feedback.category),
    body: feedback.body,
    pathname: feedback.pathname,
    releaseVersion: feedback.releaseVersion,
    status: feedback.status,
    statusLabel: feedbackStatusLabel(feedback.status),
    seasonId: feedback.seasonId,
    seasonName: seasonName ?? null,
    userId: feedback.userId,
    userLabel: userDisplayName || userEmail || null,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
  }));
}

export async function getFeedbackForAdmin(id: string): Promise<FeedbackAdminRow | null> {
  const rows = await listFeedbackForAdmin();
  return rows.find((row) => row.id === id) ?? null;
}
