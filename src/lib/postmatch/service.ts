import { commentaryAdminEligibility } from "./eligibility";
import { commentaryCancellationBlocker } from "./commentary-policy";
import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import { and, eq, isNull } from "drizzle-orm";
import { writeAuditInTx } from "@/lib/audit/write";

import type { TxDb } from "@/db/client";
import type { Match } from "@/db/schema";
import { matchCommentators, matchLiveSessions, matchVetoSessions, matches, postMatchReports, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

async function lockMatchInTx(tx: TxDb, matchId: string) {
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
  if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
  return match;
}
async function lockSubmissionInTx(tx: TxDb, matchId: string) {
  const [submission] = await tx.select().from(postMatchReports).where(eq(postMatchReports.matchId, matchId)).for("update");
  return submission ?? null;
}
async function assertCommentatorEligibleInTx(tx: TxDb, seasonId: string, userId: string, message = "解说必须是该赛事的管理员。") {
  const [grant] = await tx.select({ userId: users.id }).from(users).where(and(eq(users.id, userId), commentaryAdminEligibility(seasonId))).limit(1);
  if (!grant) throw new AppError(ErrorCode.FORBIDDEN, message);
}
async function assertRosterEditableInTx(tx: TxDb, matchId: string) {
  if (await lockSubmissionInTx(tx, matchId)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛后资料已提交；请先撤销提交后再修改解说名单。");
}
async function addCommentatorToLockedMatchInTx(tx: TxDb, match: Match, args: { userId: string; actorId: string }) {
  assertCompetitionMatch(match);
  await assertRosterEditableInTx(tx, match.id);
  if (match.status === "cancelled") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "已取消比赛不能登记解说。");
  await assertCommentatorEligibleInTx(tx, match.seasonId, args.userId);
  const current = await tx.select({ userId: matchCommentators.userId }).from(matchCommentators).where(eq(matchCommentators.matchId, match.id));
  // The DB's BEFORE INSERT capacity trigger also runs before ON CONFLICT.
  // A repeated claim must therefore stop here, including when both slots are full.
  if (current.some((row) => row.userId === args.userId)) return { seasonId: match.seasonId, added: false };
  if (current.length >= 2) throw new AppError(ErrorCode.VALIDATION_FAILED, "每场最多登记 2 名实际解说。");
  const [created] = await tx.insert(matchCommentators).values({ matchId: match.id, userId: args.userId, addedByUserId: args.actorId }).onConflictDoNothing().returning({ matchId: matchCommentators.matchId });
  if (created) await writeAuditInTx(tx, { seasonId: match.seasonId, action: "postmatch.commentator.add", actorId: args.actorId, targetId: match.id,meta: { commentatorUserId: args.userId } });
  return { seasonId: match.seasonId, added: Boolean(created) };
}
export async function addMatchCommentatorInTx(tx: TxDb, args: { matchId: string; userId: string; actorId: string }) {
  return addCommentatorToLockedMatchInTx(tx, await lockMatchInTx(tx, args.matchId), args);
}
/** Self-service assignment keeps the same roster, capacity and audit owner. */
export async function claimMatchCommentaryInTx(tx: TxDb, args: { matchId: string; userId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  if (match.status !== "scheduled" && match.status !== "in_progress") {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有待开赛或进行中的比赛可以认领。");
  }
  return addCommentatorToLockedMatchInTx(tx, match, { userId: args.userId, actorId: args.userId });
}
/** The authenticated actor can release only their own assignment. */
export async function cancelMatchCommentaryInTx(tx: TxDb, args: { matchId: string; userId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  assertCompetitionMatch(match);
  await assertCommentatorEligibleInTx(tx, match.seasonId, args.userId);
  const [veto] = await tx.select({ startedAt: matchVetoSessions.startedAt }).from(matchVetoSessions).where(eq(matchVetoSessions.matchId, match.id));
  const [source] = await tx.select({ id: matchLiveSessions.id }).from(matchLiveSessions).where(and(eq(matchLiveSessions.matchId, match.id), isNull(matchLiveSessions.closedAt)));
  const blocker = commentaryCancellationBlocker({ status: match.status, vetoStartedAt: veto?.startedAt ?? null, activeSourceId: source?.id ?? null });
  if (blocker) throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, blocker);
  await assertRosterEditableInTx(tx, match.id);
  const [removed] = await tx.delete(matchCommentators).where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, args.userId))).returning({ userId: matchCommentators.userId });
  if (removed) await writeAuditInTx(tx, { seasonId: match.seasonId, action: "postmatch.commentator.cancel", actorId: args.userId, targetId: match.id, meta: { commentatorUserId: args.userId } });
  return { seasonId: match.seasonId, removed: Boolean(removed) };
}
export async function removeMatchCommentatorInTx(tx: TxDb, args: { matchId: string; userId: string; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  await assertRosterEditableInTx(tx, match.id);
  const [removed] = await tx.delete(matchCommentators).where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, args.userId))).returning({ userId: matchCommentators.userId });
  if (removed) await writeAuditInTx(tx, { seasonId: match.seasonId, action: "postmatch.commentator.remove", actorId: args.actorId, targetId: match.id,meta: { commentatorUserId: args.userId } });
  return { seasonId: match.seasonId, removed: Boolean(removed) };
}
export async function setMatchVideoUrlInTx(tx: TxDb, args: { matchId: string; videoUrl: string | null; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有已结束比赛可以记录录像链接。");
  await tx.update(matches).set({ videoUrl: args.videoUrl, updatedAt: new Date() }).where(eq(matches.id, match.id));
  await writeAuditInTx(tx, { seasonId: match.seasonId, action: "postmatch.video.update", actorId: args.actorId, targetId: match.id,meta: { hasVideoUrl: Boolean(args.videoUrl) } });
  return { seasonId: match.seasonId };
}
export async function submitPostMatchReportInTx(tx: TxDb, args: { matchId: string; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛结束后才能提交赛后资料。");
  const [commentator] = await tx.select({ userId: matchCommentators.userId }).from(matchCommentators).where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, args.actorId)));
  if (!commentator) throw new AppError(ErrorCode.FORBIDDEN, "只有本场已登记的解说可以提交赛后资料。");
  if (await lockSubmissionInTx(tx, match.id)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "本场赛后资料已经提交。");
  await tx.insert(postMatchReports).values({ matchId: match.id, submittedByUserId: args.actorId });
  await writeAuditInTx(tx, { seasonId: match.seasonId, action: "postmatch.report.submit", actorId: args.actorId, targetId: match.id,meta: { submittedByUserId: args.actorId } });
  return { seasonId: match.seasonId };
}
export async function revokePostMatchSubmissionInTx(tx: TxDb, args: { matchId: string; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  const submission = await lockSubmissionInTx(tx, match.id);
  if (!submission) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "本场尚未提交赛后资料。");
  await tx.delete(postMatchReports).where(eq(postMatchReports.matchId, match.id));
  await writeAuditInTx(tx, { seasonId: match.seasonId, action: "postmatch.report.revoke", actorId: args.actorId, targetId: match.id,meta: { submittedByUserId: submission.submittedByUserId } });
  return { seasonId: match.seasonId };
}
export type PostMatchCompletion = "pending_collection" | "waiting_video" | "completed";
export function getPostMatchCompletion(submittedAt: Date | null, videoUrl: string | null): PostMatchCompletion { return !submittedAt ? "pending_collection" : videoUrl ? "completed" : "waiting_video"; }
export const POST_MATCH_COMPLETION_LABEL: Record<PostMatchCompletion, string> = { pending_collection: "待整理", waiting_video: "等待录像", completed: "已完成" };

export { getPublicLiveCommentators } from "@/lib/matches/presentation";
