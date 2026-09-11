import { createHash } from "node:crypto";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, feedbackReports } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import type { FeedbackCategory } from "./validation";

export const ANONYMOUS_FEEDBACK_PER_MINUTE = 20;
export const FEEDBACK_BODY_DEDUP_WINDOW_MS = 60_000;
export const AUTHENTICATED_FEEDBACK_COOLDOWN_MS = 30_000;

export function fingerprintFeedbackBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export async function submitFeedbackInTx(tx: TxDb, input: {
  actorUserId: string | null;
  seasonId: string | null;
  category: FeedbackCategory;
  body: string;
  pathname: string;
  releaseVersion: string;
}): Promise<{ accepted: boolean; id: string | null }> {
  const now = new Date();
  const minuteAgo = new Date(now.getTime() - 60_000);
  const fingerprint = fingerprintFeedbackBody(input.body);

  const [recentSameBody] = await tx.select({ count: count() }).from(feedbackReports).where(and(eq(feedbackReports.bodyFingerprint, fingerprint), gte(feedbackReports.createdAt, new Date(now.getTime() - FEEDBACK_BODY_DEDUP_WINDOW_MS))));
  if (Number(recentSameBody?.count ?? 0) > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "相同反馈刚刚已经提交过了，请稍后再试。 ");

  if (input.actorUserId) {
    const [recentByUser] = await tx.select({ count: count() }).from(feedbackReports).where(and(eq(feedbackReports.userId, input.actorUserId), gte(feedbackReports.createdAt, new Date(now.getTime() - AUTHENTICATED_FEEDBACK_COOLDOWN_MS))));
    if (Number(recentByUser?.count ?? 0) > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "反馈提交较频繁，请稍后再试。 ");
  } else {
    const [recentAnonymous] = await tx.select({ count: count() }).from(feedbackReports).where(and(isNull(feedbackReports.userId), gte(feedbackReports.createdAt, minuteAgo)));
    if (Number(recentAnonymous?.count ?? 0) >= ANONYMOUS_FEEDBACK_PER_MINUTE) throw new AppError(ErrorCode.VALIDATION_FAILED, "反馈较多，请稍后再试。 ");
  }

  const [row] = await tx.insert(feedbackReports).values({
    userId: input.actorUserId,
    seasonId: input.seasonId,
    category: input.category,
    body: input.body,
    bodyFingerprint: fingerprint,
    pathname: input.pathname,
    releaseVersion: input.releaseVersion,
  }).returning({ id: feedbackReports.id });
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "反馈提交失败。 ");
  return { accepted: true, id: row.id };
}

export async function setFeedbackStatusInTx(tx: TxDb, input: { id: string; status: "new" | "triaged" | "resolved"; actorId: string }) {
  const [existing] = await tx.select({ id: feedbackReports.id, status: feedbackReports.status, seasonId: feedbackReports.seasonId }).from(feedbackReports).where(eq(feedbackReports.id, input.id)).for("update");
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "反馈不存在。 ");
  const [row] = await tx.update(feedbackReports).set({ status: input.status, updatedAt: new Date() }).where(eq(feedbackReports.id, input.id)).returning({ id: feedbackReports.id, status: feedbackReports.status, seasonId: feedbackReports.seasonId });
  if (!row) throw new AppError(ErrorCode.INTERNAL_ERROR, "反馈状态更新失败。 ");
  await tx.insert(auditLogs).values({ seasonId: row.seasonId, action: "feedback.status_update", actorId: input.actorId, targetId: row.id, targetType: "feedback_report", meta: { from: existing.status, to: input.status } });
  return row;
}
