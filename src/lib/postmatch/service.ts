import { hasMatchRecording, recordingInput, type MatchRecording } from "./recording-types";
import { commentaryAdminEligibility } from "./eligibility";
import { commentaryCancellationBlocker } from "./commentary-policy";
import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import { and, eq, isNull } from "drizzle-orm";
import { writeAuditInTx } from "@/lib/audit/write";

import type { TxDb } from "@/db/client";
import type { Match } from "@/db/schema";
import { matchCommentators, matchLiveSessions, matchVetoSessions, matches, postMatchReports, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { readReopenedPostMatchIds } from "./read";

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
async function assertRosterEditableInTx(tx: TxDb, match: Match) {
  if (await lockSubmissionInTx(tx, match.id) || (match.status === "finished" && !(await readReopenedPostMatchIds(tx, [match.id])).has(match.id)))
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先重开解说名单，再修改实际解说。");
}
async function addCommentatorToLockedMatchInTx(tx: TxDb, match: Match, args: { userId: string; actorId: string }) {
  assertCompetitionMatch(match);
  await assertRosterEditableInTx(tx, match);
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
  await assertRosterEditableInTx(tx, match);
  const [removed] = await tx.delete(matchCommentators).where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, args.userId))).returning({ userId: matchCommentators.userId });
  if (removed) await writeAuditInTx(tx, { seasonId: match.seasonId, action: "postmatch.commentator.cancel", actorId: args.userId, targetId: match.id, meta: { commentatorUserId: args.userId } });
  return { seasonId: match.seasonId, removed: Boolean(removed) };
}
export async function removeMatchCommentatorInTx(tx: TxDb, args: { matchId: string; userId: string; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  await assertRosterEditableInTx(tx, match);
  const [removed] = await tx.delete(matchCommentators).where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, args.userId))).returning({ userId: matchCommentators.userId });
  if (removed) await writeAuditInTx(tx, { seasonId: match.seasonId, action: "postmatch.commentator.remove", actorId: args.actorId, targetId: match.id,meta: { commentatorUserId: args.userId } });
  return { seasonId: match.seasonId, removed: Boolean(removed) };
}
export async function setMatchVideoUrlInTx(tx: TxDb, args: { matchId: string; videoUrl: string | null; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有已结束比赛可以记录录像链接。");
  const rosterReopened = (await readReopenedPostMatchIds(tx, [match.id])).has(match.id);
  await tx.update(matches).set({ videoUrl: args.videoUrl, updatedAt: new Date() }).where(eq(matches.id, match.id));
  await writeAuditInTx(tx, {
    seasonId: match.seasonId, action: "postmatch.video.update", actorId: args.actorId, targetId: match.id,
    meta: {
      hasVideoUrl: Boolean(args.videoUrl),
      before: { hasVideoUrl: hasMatchRecording(match), rosterReopened },
      after: { hasVideoUrl: hasMatchRecording({ ...match, videoUrl: args.videoUrl }), rosterReopened },
      videoChange: match.videoUrl === args.videoUrl ? "unchanged" : !args.videoUrl ? "cleared" : !match.videoUrl ? "added" : "replaced",
    },
  });
  return { seasonId: match.seasonId };
}
export async function submitPostMatchReportInTx(tx: TxDb, args: { matchId: string; actorId: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛结束后才能提交赛后资料。");
  const [commentator] = await tx.select({ userId: matchCommentators.userId }).from(matchCommentators).where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, args.actorId)));
  if (!commentator) throw new AppError(ErrorCode.FORBIDDEN, "只有本场已登记的解说可以提交赛后资料。");
  if (await lockSubmissionInTx(tx, match.id)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "本场赛后资料已经提交。");
  await tx.insert(postMatchReports).values({ matchId: match.id, submittedByUserId: args.actorId });
  await writeAuditInTx(tx, {
    seasonId: match.seasonId, action: "postmatch.report.submit", actorId: args.actorId, targetId: match.id,
    meta: {
      submittedByUserId: args.actorId,
      before: { submitted: false, hasVideoUrl: hasMatchRecording(match) },
      after: { submitted: true, hasVideoUrl: hasMatchRecording(match) },
    },
  });
  return { seasonId: match.seasonId };
}
export async function revokePostMatchSubmissionInTx(tx: TxDb, args: { matchId: string; actorId: string; reason?: string }) {
  const match = await lockMatchInTx(tx, args.matchId);
  const submission = await lockSubmissionInTx(tx, match.id);
  if (!submission) {
    if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛结束后才能更正实际解说名单。");
    if ((await readReopenedPostMatchIds(tx, [match.id])).has(match.id))
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "本场解说名单已经开放更正。");
    await writeAuditInTx(tx, { seasonId: match.seasonId, action: "postmatch.report.revoke", actorId: args.actorId,
      targetId: match.id, meta: { before: { submitted: false, hasVideoUrl: hasMatchRecording(match), rosterReopened: false },
        after: { submitted: false, hasVideoUrl: hasMatchRecording(match), rosterReopened: true },
        ...(args.reason?.trim() ? { reason: args.reason.trim() } : {}) } });
    return { seasonId: match.seasonId };
  }
  await tx.delete(postMatchReports).where(eq(postMatchReports.matchId, match.id));
  await writeAuditInTx(tx, {
    seasonId: match.seasonId, action: "postmatch.report.revoke", actorId: args.actorId, targetId: match.id,
    meta: {
      submittedByUserId: submission.submittedByUserId,
      originalSubmittedAt: submission.submittedAt.toISOString(),
      before: { submitted: true, hasVideoUrl: hasMatchRecording(match) },
      after: { submitted: false, hasVideoUrl: hasMatchRecording(match) },
      ...(args.reason?.trim() ? { reason: args.reason.trim() } : {}),
    },
  });
  return { seasonId: match.seasonId };
}
export { getPostMatchCompletion, POST_MATCH_COMPLETION_LABEL, type PostMatchCompletion } from "./completion";

export { getPublicLiveCommentators } from "@/lib/matches/presentation";

/** Match lock serializes individual edits; never replace another commentator's list. */
export async function mutateMatchRecordingInTx(tx: TxDb, args: {
  matchId: string; actorId: string;
  command: { kind: "save"; recording: MatchRecording } | { kind: "remove"; id: string } | { kind: "move"; id: string; direction: "up" | "down" };
}) {
  const match = await lockMatchInTx(tx, args.matchId);
  assertCompetitionMatch(match);
  await assertCommentatorEligibleInTx(tx, match.seasonId, args.actorId, "只有赛事管理员可以管理录像。");
  if (match.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有已结束比赛可以记录录像链接。");
  const recordings = [...match.recordings];
  const command = args.command;
  const id = command.kind === "save" ? command.recording.id : command.id;
  const index = recordings.findIndex(row => row.id === id);
  if (command.kind === "save") {
    const parsed = recordingInput.safeParse(command.recording);
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_FAILED, "录像参数无效。");
    const [person] = await tx.select({ userId: matchCommentators.userId }).from(matchCommentators)
      .where(and(eq(matchCommentators.matchId, match.id), eq(matchCommentators.userId, parsed.data.commentatorUserId)));
    if (!person) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先登记本场实际解说。");
    if (index >= 0) recordings[index] = parsed.data; else recordings.push(parsed.data);
  } else if (index >= 0) {
    if (command.kind === "remove") recordings.splice(index, 1);
    else {
      // Reorder within the person's group; other groups keep their order.
      const step = command.direction === "up" ? -1 : 1;
      let other = index + step;
      while (other >= 0 && other < recordings.length && recordings[other]!.commentatorUserId !== recordings[index]!.commentatorUserId) other += step;
      if (other >= 0 && other < recordings.length) [recordings[index], recordings[other]] = [recordings[other]!, recordings[index]!];
    }
  }
  await tx.update(matches).set({ recordings, updatedAt: new Date() }).where(eq(matches.id, match.id));
  await writeAuditInTx(tx, { seasonId: match.seasonId, action: `postmatch.recording.${command.kind}`,
    actorId: args.actorId, targetId: match.id, meta: { recordingId: id, count: recordings.length, hasVideoUrl: hasMatchRecording({ ...match, recordings }) } });
  return { seasonId: match.seasonId };
}
