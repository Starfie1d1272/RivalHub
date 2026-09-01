import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, matchCommentators, matches, postMatchReports, seasonAdminGrants } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { isHttpUrl } from "@/lib/external-url";

async function lockMatchInTx(tx: TxDb, matchId: string) {
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
  if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
  return match;
}
async function lockSubmissionInTx(tx: TxDb, matchId: string) {
  const [submission] = await tx.select().from(postMatchReports).where(eq(postMatchReports.matchId, matchId)).for("update");
  return submission ?? null;
}
async function assertSeasonAdminInTx(tx: TxDb, seasonId: string, userId: string, message = "解说必须是该赛事的管理员。") {
  const [grant] = await tx.select({ userId: seasonAdminGrants.userId }).from(seasonAdminGrants).where(and(eq(seasonAdminGrants.seasonId, seasonId), eq(seasonAdminGrants.userId, userId)));
  if (!grant) throw new AppError(ErrorCode.FORBIDDEN, message);
}
async function assertRosterEditableInTx(tx: TxDb, matchId: string) {
  if (await lockSubmissionInTx(tx, matchId)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛后资料已提交；请先撤销提交后再修改解说名单。");
}
export async function addMatchCommentatorInTx(tx: TxDb, args: { matchId: string; userId: string; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  await assertRosterEditableInTx(tx, match.id);
  if (match.status === "cancelled") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "已取消比赛不能登记解说。");
  await assertSeasonAdminInTx(tx, match.seasonId, args.userId);
  const current = await tx.select({ userId: matchCommentators.userId }).from(matchCommentators).where(eq(matchCommentators.matchId, match.id));
  if (current.length >= 2 && !current.some((row) => row.userId === args.userId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "每场最多登记 2 名实际解说。");
  const [created] = await tx.insert(matchCommentators).values({ matchId: match.id, userId: args.userId, addedByUserId: args.actorId }).onConflictDoNothing().returning({ matchId: matchCommentators.matchId });
  if (created) await tx.insert(auditLogs).values({ seasonId: match.seasonId, action: "postmatch.commentator.add", actorId: args.actorId, targetId: match.id, targetType: "match", meta: { commentatorUserId: args.userId } });
  return { seasonId: match.seasonId, added: Boolean(created) };
}
export async function removeMatchCommentatorInTx(tx: TxDb, args: { matchId: string; userId: string; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  await assertRosterEditableInTx(tx, match.id);
  const [removed] = await tx.delete(matchCommentators).where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, args.userId))).returning({ userId: matchCommentators.userId });
  if (removed) await tx.insert(auditLogs).values({ seasonId: match.seasonId, action: "postmatch.commentator.remove", actorId: args.actorId, targetId: match.id, targetType: "match", meta: { commentatorUserId: args.userId } });
  return { seasonId: match.seasonId, removed: Boolean(removed) };
}
export async function setMatchVideoUrlInTx(tx: TxDb, args: { matchId: string; videoUrl: string | null; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有已结束比赛可以记录录像链接。");
  await tx.update(matches).set({ videoUrl: args.videoUrl, updatedAt: new Date() }).where(eq(matches.id, match.id));
  await tx.insert(auditLogs).values({ seasonId: match.seasonId, action: "postmatch.video.update", actorId: args.actorId, targetId: match.id, targetType: "match", meta: { hasVideoUrl: Boolean(args.videoUrl) } });
  return { seasonId: match.seasonId };
}
export async function submitPostMatchReportInTx(tx: TxDb, args: { matchId: string; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛结束后才能提交赛后资料。");
  const [commentator] = await tx.select({ userId: matchCommentators.userId }).from(matchCommentators).where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, args.actorId)));
  if (!commentator) throw new AppError(ErrorCode.FORBIDDEN, "只有本场已登记的解说可以提交赛后资料。");
  if (await lockSubmissionInTx(tx, match.id)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "本场赛后资料已经提交。");
  await tx.insert(postMatchReports).values({ matchId: match.id, submittedByUserId: args.actorId });
  await tx.insert(auditLogs).values({ seasonId: match.seasonId, action: "postmatch.report.submit", actorId: args.actorId, targetId: match.id, targetType: "match", meta: { submittedByUserId: args.actorId } });
  return { seasonId: match.seasonId };
}
export async function revokePostMatchSubmissionInTx(tx: TxDb, args: { matchId: string; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  const submission = await lockSubmissionInTx(tx, match.id);
  if (!submission) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "本场尚未提交赛后资料。");
  await tx.delete(postMatchReports).where(eq(postMatchReports.matchId, match.id));
  await tx.insert(auditLogs).values({ seasonId: match.seasonId, action: "postmatch.report.revoke", actorId: args.actorId, targetId: match.id, targetType: "match", meta: { submittedByUserId: submission.submittedByUserId } });
  return { seasonId: match.seasonId };
}
export type PostMatchCompletion = "pending_collection" | "waiting_video" | "completed";
export function getPostMatchCompletion(submittedAt: Date | null, videoUrl: string | null): PostMatchCompletion { return !submittedAt ? "pending_collection" : videoUrl ? "completed" : "waiting_video"; }
export const POST_MATCH_COMPLETION_LABEL: Record<PostMatchCompletion, string> = { pending_collection: "待整理", waiting_video: "等待录像", completed: "已完成" };

export function getPublicLiveCommentators<T extends { liveStreamUrl: string | null }>(status: "scheduled" | "in_progress" | "finished" | "cancelled", commentators: T[]): T[] {
  return status === "scheduled" || status === "in_progress" ? commentators.filter((commentator) => commentator.liveStreamUrl !== null && isHttpUrl(commentator.liveStreamUrl)) : [];
}
