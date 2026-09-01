import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, communityAwardEvidence, communityAwards, matches, seasons, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

async function lockAwardInTx(tx: TxDb, awardId: string) {
  const [award] = await tx.select().from(communityAwards).where(eq(communityAwards.id, awardId)).for("update");
  if (!award) throw new AppError(ErrorCode.NOT_FOUND, "社区奖不存在。 ");
  return award;
}

export async function submitCommunityAwardInTx(
  tx: TxDb,
  args: { seasonId: string; submitterId: string; name: string; condition: string; prize: string; supplementaryNote?: string | null },
): Promise<{ awardId: string }> {
  const [season] = await tx.select({ id: seasons.id, status: seasons.status }).from(seasons).where(eq(seasons.id, args.seasonId));
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
  if (season.status === "archived") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已归档赛事不能提交新的社区奖。 ");
  const [award] = await tx.insert(communityAwards).values({
    seasonId: args.seasonId,
    submittedByUserId: args.submitterId,
    name: args.name,
    condition: args.condition,
    prize: args.prize,
    supplementaryNote: args.supplementaryNote ?? null,
  }).returning({ id: communityAwards.id });
  await tx.insert(auditLogs).values({
    seasonId: args.seasonId,
    action: "community_award.submit",
    actorId: args.submitterId,
    targetId: award!.id,
    targetType: "community_award",
    meta: { name: args.name },
  });
  return { awardId: award!.id };
}

export async function reviseCommunityAwardInTx(
  tx: TxDb,
  args: { awardId: string; submitterId: string; name: string; condition: string; prize: string; supplementaryNote?: string | null },
): Promise<{ seasonId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  if (award.submittedByUserId !== args.submitterId) throw new AppError(ErrorCode.UNAUTHORIZED, "只有发起人可以补充这项社区奖。 ");
  if (award.status !== "pending_review") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有待审核社区奖可以补充。 ");
  await tx.update(communityAwards).set({
    name: args.name,
    condition: args.condition,
    prize: args.prize,
    supplementaryNote: args.supplementaryNote ?? null,
    updatedAt: new Date(),
  }).where(eq(communityAwards.id, award.id));
  await tx.insert(auditLogs).values({
    seasonId: award.seasonId,
    action: "community_award.revise",
    actorId: args.submitterId,
    targetId: award.id,
    targetType: "community_award",
    meta: {},
  });
  return { seasonId: award.seasonId };
}

export async function reviewCommunityAwardInTx(
  tx: TxDb,
  args: { awardId: string; status: "approved" | "rejected"; publicNote?: string | null; reviewNote?: string | null; actorId: string },
): Promise<{ seasonId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  if (award.status !== "pending_review") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有待审核社区奖可以处理。 ");
  const now = new Date();
  await tx.update(communityAwards).set({
    status: args.status,
    publicNote: args.publicNote ?? null,
    reviewNote: args.reviewNote ?? null,
    reviewedByUserId: args.actorId,
    reviewedAt: now,
    updatedAt: now,
  }).where(eq(communityAwards.id, award.id));
  await tx.insert(auditLogs).values({
    seasonId: award.seasonId,
    action: `community_award.${args.status}`,
    actorId: args.actorId,
    targetId: award.id,
    targetType: "community_award",
    meta: { hasPublicNote: !!args.publicNote, hasReviewNote: !!args.reviewNote },
  });
  return { seasonId: award.seasonId };
}

export async function requestCommunityAwardSupplementInTx(
  tx: TxDb,
  args: { awardId: string; note: string; actorId: string },
): Promise<{ seasonId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  if (award.status !== "pending_review") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有待审核社区奖可以要求补充。 ");
  const now = new Date();
  await tx.update(communityAwards).set({ reviewNote: args.note, reviewedByUserId: args.actorId, reviewedAt: now, updatedAt: now })
    .where(eq(communityAwards.id, award.id));
  await tx.insert(auditLogs).values({
    seasonId: award.seasonId,
    action: "community_award.request_supplement",
    actorId: args.actorId,
    targetId: award.id,
    targetType: "community_award",
    meta: {},
  });
  return { seasonId: award.seasonId };
}

export async function withdrawCommunityAwardInTx(
  tx: TxDb,
  args: { awardId: string; submitterId: string },
): Promise<{ seasonId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  if (award.submittedByUserId !== args.submitterId) throw new AppError(ErrorCode.UNAUTHORIZED, "只有发起人可以撤回这项社区奖。 ");
  if (award.status !== "pending_review" && award.status !== "approved") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已产生结果或已拒绝的社区奖不能由发起人撤回。 ");
  const now = new Date();
  await tx.update(communityAwards).set({ status: "withdrawn", recipientUserId: null, outcomeNote: "发起人撤回", outcomeByUserId: args.submitterId, outcomeAt: now, updatedAt: now })
    .where(eq(communityAwards.id, award.id));
  await tx.insert(auditLogs).values({
    seasonId: award.seasonId,
    action: "community_award.withdraw",
    actorId: args.submitterId,
    targetId: award.id,
    targetType: "community_award",
    meta: { from: award.status },
  });
  return { seasonId: award.seasonId };
}

export async function addCommunityAwardEvidenceInTx(
  tx: TxDb,
  args: { awardId: string; submitterId: string; candidateUserId?: string | null; matchId?: string | null; explanation: string; videoUrl?: string | null },
): Promise<{ seasonId: string; evidenceId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  if (award.status !== "approved") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有已公开的社区奖可以提交候选证据。 ");
  if (args.matchId) {
    const [match] = await tx.select({ id: matches.id }).from(matches).where(and(eq(matches.id, args.matchId), eq(matches.seasonId, award.seasonId)));
    if (!match) throw new AppError(ErrorCode.VALIDATION_FAILED, "证据比赛不属于当前赛事。 ");
  }
  if (args.candidateUserId) {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, args.candidateUserId));
    if (!user) throw new AppError(ErrorCode.VALIDATION_FAILED, "候选用户不存在。 ");
  }
  const [evidence] = await tx.insert(communityAwardEvidence).values({
    awardId: award.id,
    submittedByUserId: args.submitterId,
    candidateUserId: args.candidateUserId ?? null,
    matchId: args.matchId ?? null,
    explanation: args.explanation,
    videoUrl: args.videoUrl ?? null,
  }).returning({ id: communityAwardEvidence.id });
  await tx.insert(auditLogs).values({
    seasonId: award.seasonId,
    action: "community_award.evidence.submit",
    actorId: args.submitterId,
    targetId: evidence!.id,
    targetType: "community_award_evidence",
    meta: { awardId: award.id, candidateUserId: args.candidateUserId ?? null, matchId: args.matchId ?? null },
  });
  return { seasonId: award.seasonId, evidenceId: evidence!.id };
}

export async function resolveCommunityAwardInTx(
  tx: TxDb,
  args: { awardId: string; status: "awarded" | "not_awarded" | "cancelled"; recipientUserId?: string | null; outcomeNote: string; actorId: string },
): Promise<{ seasonId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  if (award.status !== "approved") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有已公开社区奖可以结奖、记录不颁或取消。 ");
  if (args.status === "awarded" && !args.recipientUserId) throw new AppError(ErrorCode.VALIDATION_FAILED, "结奖时必须选择获奖者。 ");
  if (args.status !== "awarded" && args.recipientUserId) throw new AppError(ErrorCode.VALIDATION_FAILED, "不颁或取消时不能保留获奖者。 ");
  if (args.recipientUserId) {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, args.recipientUserId));
    if (!user) throw new AppError(ErrorCode.VALIDATION_FAILED, "获奖者不存在。 ");
  }
  const now = new Date();
  await tx.update(communityAwards).set({
    status: args.status,
    recipientUserId: args.recipientUserId ?? null,
    outcomeNote: args.outcomeNote,
    outcomeByUserId: args.actorId,
    outcomeAt: now,
    updatedAt: now,
  }).where(eq(communityAwards.id, award.id));
  await tx.insert(auditLogs).values({
    seasonId: award.seasonId,
    action: `community_award.${args.status}`,
    actorId: args.actorId,
    targetId: award.id,
    targetType: "community_award",
    meta: { recipientUserId: args.recipientUserId ?? null },
  });
  return { seasonId: award.seasonId };
}
