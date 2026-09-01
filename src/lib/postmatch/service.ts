import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, matchCommentators, matches, postMatchReports, seasonAdminGrants, seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

async function lockMatchInTx(tx: TxDb, matchId: string) {
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
  if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。 ");
  return match;
}

async function assertSeasonAdminInTx(tx: TxDb, seasonId: string, userId: string, message = "解说必须是该赛事的管理员。 "): Promise<void> {
  const [grant] = await tx.select({ userId: seasonAdminGrants.userId }).from(seasonAdminGrants)
    .where(and(eq(seasonAdminGrants.seasonId, seasonId), eq(seasonAdminGrants.userId, userId)));
  if (!grant) throw new AppError(ErrorCode.UNAUTHORIZED, message);
}

async function lockReportInTx(tx: TxDb, matchId: string) {
  const [report] = await tx.select().from(postMatchReports).where(eq(postMatchReports.matchId, matchId)).for("update");
  return report ?? null;
}

export async function addMatchCommentatorInTx(
  tx: TxDb,
  args: { matchId: string; userId: string; actorId: string },
): Promise<{ seasonId: string; added: boolean }> {
  const match = await lockMatchInTx(tx, args.matchId);
  const report = await lockReportInTx(tx, match.id);
  if (report?.status === "confirmed") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已确认的赛后记录不能修改解说名单。 ");
  await assertSeasonAdminInTx(tx, match.seasonId, args.userId);
  const [created] = await tx.insert(matchCommentators).values({
    matchId: match.id,
    userId: args.userId,
    addedByUserId: args.actorId,
  }).onConflictDoNothing().returning({ matchId: matchCommentators.matchId });
  if (created) await tx.insert(auditLogs).values({
    seasonId: match.seasonId,
    action: "postmatch.commentator.add",
    actorId: args.actorId,
    targetId: `${match.id}:${args.userId}`,
    targetType: "match_commentator",
    meta: { matchId: match.id, userId: args.userId },
  });
  return { seasonId: match.seasonId, added: !!created };
}

export async function removeMatchCommentatorInTx(
  tx: TxDb,
  args: { matchId: string; userId: string; actorId: string },
): Promise<{ seasonId: string; removed: boolean }> {
  const match = await lockMatchInTx(tx, args.matchId);
  const report = await lockReportInTx(tx, match.id);
  if (report?.status === "confirmed") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已确认的赛后记录不能修改解说名单。 ");
  const [removed] = await tx.delete(matchCommentators).where(and(
    eq(matchCommentators.matchId, match.id),
    eq(matchCommentators.userId, args.userId),
  )).returning({ userId: matchCommentators.userId });
  if (removed) await tx.insert(auditLogs).values({
    seasonId: match.seasonId,
    action: "postmatch.commentator.remove",
    actorId: args.actorId,
    targetId: `${match.id}:${args.userId}`,
    targetType: "match_commentator",
    meta: { matchId: match.id, userId: args.userId },
  });
  return { seasonId: match.seasonId, removed: !!removed };
}

export async function setMatchVideoUrlInTx(
  tx: TxDb,
  args: { matchId: string; videoUrl: string | null; actorId: string },
): Promise<{ seasonId: string }> {
  const match = await lockMatchInTx(tx, args.matchId);
  if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有已结束比赛可以记录录像链接。 ");
  await tx.update(matches).set({ videoUrl: args.videoUrl, updatedAt: new Date() }).where(eq(matches.id, match.id));
  await tx.insert(auditLogs).values({
    seasonId: match.seasonId,
    action: "postmatch.video.update",
    actorId: args.actorId,
    targetId: match.id,
    targetType: "match",
    meta: { hasVideoUrl: !!args.videoUrl },
  });
  return { seasonId: match.seasonId };
}

export async function submitPostMatchReportInTx(
  tx: TxDb,
  args: { matchId: string; actorId: string },
): Promise<{ seasonId: string }> {
  const match = await lockMatchInTx(tx, args.matchId);
  if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛结束后才能提交赛后资料。 ");
  const [responsibility] = await tx.select({ userId: matchCommentators.userId }).from(matchCommentators)
    .where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, args.actorId)));
  if (!responsibility) throw new AppError(ErrorCode.UNAUTHORIZED, "只有本场已登记的解说可以提交赛后资料。 ");
  const report = await lockReportInTx(tx, match.id);
  if (report?.status === "confirmed") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "本场赛后资料已确认。 ");
  const now = new Date();
  if (report) {
    await tx.update(postMatchReports).set({
      status: "submitted",
      submittedByUserId: args.actorId,
      submittedAt: now,
      returnedByUserId: null,
      returnedAt: null,
      returnReason: null,
      updatedAt: now,
    }).where(eq(postMatchReports.matchId, match.id));
  } else {
    await tx.insert(postMatchReports).values({
      matchId: match.id,
      seasonId: match.seasonId,
      status: "submitted",
      submittedByUserId: args.actorId,
      submittedAt: now,
    });
  }
  await tx.insert(auditLogs).values({
    seasonId: match.seasonId,
    action: "postmatch.report.submit",
    actorId: args.actorId,
    targetId: match.id,
    targetType: "post_match_report",
    meta: { matchId: match.id },
  });
  return { seasonId: match.seasonId };
}

export async function confirmPostMatchReportInTx(
  tx: TxDb,
  args: { matchId: string; actorId: string },
): Promise<{ seasonId: string; commentatorCount: number }> {
  const match = await lockMatchInTx(tx, args.matchId);
  const report = await lockReportInTx(tx, match.id);
  if (!report || report.status !== "submitted" || !report.submittedByUserId) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有已提交的赛后资料可以确认。 ");
  }
  if (report.submittedByUserId === args.actorId) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "提交人不能自行确认本场赛后资料。 ");
  }
  const commentators = await tx.select({ userId: matchCommentators.userId }).from(matchCommentators)
    .where(eq(matchCommentators.matchId, match.id));
  if (commentators.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先登记至少一名实际解说。 ");
  const [season] = await tx.select({ fee: seasons.commentatorFeeCents }).from(seasons).where(eq(seasons.id, match.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
  const now = new Date();
  await tx.update(postMatchReports).set({
    status: "confirmed",
    confirmedByUserId: args.actorId,
    confirmedAt: now,
    updatedAt: now,
  }).where(eq(postMatchReports.matchId, match.id));
  await tx.update(matchCommentators).set({
    confirmedAt: now,
    confirmedByUserId: args.actorId,
    confirmedFeeCents: season.fee,
  }).where(eq(matchCommentators.matchId, match.id));
  await tx.insert(auditLogs).values({
    seasonId: match.seasonId,
    action: "postmatch.report.confirm",
    actorId: args.actorId,
    targetId: match.id,
    targetType: "post_match_report",
    meta: { matchId: match.id, commentatorCount: commentators.length, feeCents: season.fee },
  });
  return { seasonId: match.seasonId, commentatorCount: commentators.length };
}

export async function returnPostMatchReportInTx(
  tx: TxDb,
  args: { matchId: string; reason: string; actorId: string },
): Promise<{ seasonId: string }> {
  const match = await lockMatchInTx(tx, args.matchId);
  const report = await lockReportInTx(tx, match.id);
  if (!report || report.status !== "submitted") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有已提交的赛后资料可以退回。 ");
  const now = new Date();
  await tx.update(postMatchReports).set({
    status: "returned",
    returnedByUserId: args.actorId,
    returnedAt: now,
    returnReason: args.reason,
    updatedAt: now,
  }).where(eq(postMatchReports.matchId, match.id));
  await tx.insert(auditLogs).values({
    seasonId: match.seasonId,
    action: "postmatch.report.return",
    actorId: args.actorId,
    targetId: match.id,
    targetType: "post_match_report",
    meta: { reason: args.reason },
  });
  return { seasonId: match.seasonId };
}

export async function settleCommentatorInTx(
  tx: TxDb,
  args: { seasonId: string; userId: string; actorId: string },
): Promise<{ settledMatches: number; settledFeeCents: number }> {
  const pending = await tx.select({ matchId: matchCommentators.matchId, fee: matchCommentators.confirmedFeeCents })
    .from(matchCommentators)
    .innerJoin(matches, eq(matchCommentators.matchId, matches.id))
    .where(and(eq(matches.seasonId, args.seasonId), eq(matchCommentators.userId, args.userId), isNull(matchCommentators.settledAt)));
  const confirmable = pending.filter((row) => row.fee !== null);
  if (confirmable.length === 0) return { settledMatches: 0, settledFeeCents: 0 };
  const matchIds = confirmable.map((row) => row.matchId);
  const now = new Date();
  await tx.update(matchCommentators).set({ settledAt: now, settledByUserId: args.actorId }).where(and(
    eq(matchCommentators.userId, args.userId),
    inArray(matchCommentators.matchId, matchIds),
    isNull(matchCommentators.settledAt),
  ));
  const settledFeeCents = confirmable.reduce((total, row) => total + (row.fee ?? 0), 0);
  await tx.insert(auditLogs).values({
    seasonId: args.seasonId,
    action: "postmatch.commentator.settle",
    actorId: args.actorId,
    targetId: args.userId,
    targetType: "user",
    meta: { matchIds, settledMatches: matchIds.length, settledFeeCents },
  });
  return { settledMatches: matchIds.length, settledFeeCents };
}
