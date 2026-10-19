import { officialMatchCondition } from "@/lib/matches/scope";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { writeAuditInTx } from "@/lib/audit/write";

import type { TxDb } from "@/db/client";
import { communityAwardEvidence, communityAwardRecipients, communityAwards, matches, seasons } from "@/db/schema";
import { canSettleCommunityAward, type CommunityAwardOutcome } from "./policy";
import { getCommunityAwardProgress } from "./progress";
import { AppError, ErrorCode } from "@/lib/errors";
import { getSeasonAwardCandidates } from "@/lib/community-awards/read-model";

async function assertCommunityAwardsEnabledInTx(tx: TxDb, seasonId: string) {
  const [season] = await tx.select({
    id: seasons.id,
    status: seasons.status,
    hasCommunityAwards: seasons.hasCommunityAwards,
  }).from(seasons).where(eq(seasons.id, seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。 ");
  if (!season.hasCommunityAwards) {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "该赛事未启用社区奖。 ");
  }
  return season;
}

async function lockAwardInTx(tx: TxDb, awardId: string) {
  const [award] = await tx.select().from(communityAwards).where(eq(communityAwards.id, awardId)).for("update");
  if (!award) throw new AppError(ErrorCode.NOT_FOUND, "社区奖不存在。 ");
  await assertCommunityAwardsEnabledInTx(tx, award.seasonId);
  return award;
}

export async function submitCommunityAwardInTx(
  tx: TxDb,
  args: { seasonId: string; submitterId: string; name: string; condition: string; prize: string; supplementaryNote?: string | null },
): Promise<{ awardId: string }> {
  const season = await assertCommunityAwardsEnabledInTx(tx, args.seasonId);
  if (season.status === "archived") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已归档赛事不能提交新的社区奖。 ");
  const [award] = await tx.insert(communityAwards).values({
    seasonId: args.seasonId,
    submittedByUserId: args.submitterId,
    name: args.name,
    condition: args.condition,
    prize: args.prize,
    supplementaryNote: args.supplementaryNote ?? null,
  }).returning({ id: communityAwards.id });
  await writeAuditInTx(tx, {
    seasonId: args.seasonId,
    action: "community_award.submit",
    actorId: args.submitterId,
    targetId: award!.id,meta: { name: args.name },
  });
  return { awardId: award!.id };
}

export async function reviseCommunityAwardInTx(
  tx: TxDb,
  args: { awardId: string; submitterId: string; name: string; condition: string; prize: string; supplementaryNote?: string | null },
): Promise<{ seasonId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  if (award.submittedByUserId !== args.submitterId) throw new AppError(ErrorCode.FORBIDDEN, "只有发起人可以补充这项社区奖。 ");
  if (award.status !== "pending_review" && award.status !== "rejected") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有待审核或被要求补充的社区奖可以修改。 ");
  await tx.update(communityAwards).set({
    name: args.name,
    condition: args.condition,
    prize: args.prize,
    supplementaryNote: args.supplementaryNote ?? null,
    status: "pending_review",
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    updatedAt: new Date(),
  }).where(eq(communityAwards.id, award.id));
  await writeAuditInTx(tx, {
    seasonId: award.seasonId,
    action: "community_award.revise",
    actorId: args.submitterId,
    targetId: award.id,meta: {},
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
  await writeAuditInTx(tx, {
    seasonId: award.seasonId,
    action: `community_award.${args.status}`,
    actorId: args.actorId,
    targetId: award.id,meta: { hasPublicNote: !!args.publicNote, hasReviewNote: !!args.reviewNote },
  });
  return { seasonId: award.seasonId };
}

export async function requestCommunityAwardSupplementInTx(
  tx: TxDb,
  args: { awardId: string; note: string; actorId: string },
): Promise<{ seasonId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  if (award.status !== "pending_review") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有待审核社区奖可以要求补充。 ");
  await tx.update(communityAwards).set({ reviewNote: args.note, updatedAt: new Date() })
    .where(eq(communityAwards.id, award.id));
  await writeAuditInTx(tx, {
    seasonId: award.seasonId,
    action: "community_award.request_supplement",
    actorId: args.actorId,
    targetId: award.id,meta: {},
  });
  return { seasonId: award.seasonId };
}

export async function withdrawCommunityAwardInTx(
  tx: TxDb,
  args: { awardId: string; submitterId: string },
): Promise<{ seasonId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  if (award.submittedByUserId !== args.submitterId) throw new AppError(ErrorCode.FORBIDDEN, "只有发起人可以撤回这项社区奖。 ");
  if (award.status !== "pending_review" && award.status !== "approved") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已产生结果或已拒绝的社区奖不能由发起人撤回。 ");
  const now = new Date();
  await tx.update(communityAwards).set({ status: "withdrawn", recipientUserId: null, outcomeNote: "发起人撤回", outcomeByUserId: args.submitterId, outcomeAt: now, updatedAt: now })
    .where(eq(communityAwards.id, award.id));
  await writeAuditInTx(tx, {
    seasonId: award.seasonId,
    action: "community_award.withdraw",
    actorId: args.submitterId,
    targetId: award.id,meta: { from: award.status },
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
    const [match] = await tx.select({ id: matches.id }).from(matches).where(and(officialMatchCondition(), and(eq(matches.id, args.matchId), eq(matches.seasonId, award.seasonId))));
    if (!match) throw new AppError(ErrorCode.VALIDATION_FAILED, "证据比赛不属于当前赛事。 ");
  }
  if (args.candidateUserId) {
    if (!(await getSeasonAwardCandidates(tx, award.seasonId)).some((candidate) => candidate.id === args.candidateUserId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "候选人不属于当前赛事相关人员。 ");
  }
  const [evidence] = await tx.insert(communityAwardEvidence).values({
    awardId: award.id,
    submittedByUserId: args.submitterId,
    candidateUserId: args.candidateUserId ?? null,
    matchId: args.matchId ?? null,
    explanation: args.explanation,
    videoUrl: args.videoUrl ?? null,
  }).returning({ id: communityAwardEvidence.id });
  await writeAuditInTx(tx, {
    seasonId: award.seasonId,
    action: "community_award.evidence.submit",
    actorId: args.submitterId,
    targetId: evidence!.id,meta: { awardId: award.id, candidateUserId: args.candidateUserId ?? null, matchId: args.matchId ?? null },
  });
  return { seasonId: award.seasonId, evidenceId: evidence!.id };
}

type Outcome = CommunityAwardOutcome;
type AwardPolicy = Pick<typeof communityAwards.$inferSelect, "recipientPolicy" | "recipientLimit" | "settlementPolicy" | "settlementStageKey">;

async function currentRecipients(tx: TxDb, awardId: string): Promise<string[]> {
  return (await tx.select({ userId: communityAwardRecipients.userId }).from(communityAwardRecipients)
    .where(eq(communityAwardRecipients.awardId, awardId)).orderBy(asc(communityAwardRecipients.position), asc(communityAwardRecipients.userId))).map(row => row.userId);
}

async function eligibleCandidateIds(tx: TxDb, awardId: string): Promise<string[]> {
  return (await tx.select({ candidateUserId: communityAwardEvidence.candidateUserId }).from(communityAwardEvidence)
    .where(and(eq(communityAwardEvidence.awardId, awardId), eq(communityAwardEvidence.verificationStatus, "eligible"))))
    .flatMap(row => row.candidateUserId ? [row.candidateUserId] : []);
}

function assertVersion(actual: number, expected: number) {
  if (actual !== expected) throw new AppError(ErrorCode.VALIDATION_FAILED, "奖项已被其他管理员更新，请刷新后重试。 ");
}

function assertRecipientCount(policy: AwardPolicy, count: number) {
  if (policy.recipientPolicy !== "all_ties" && count > (policy.recipientLimit ?? 1)) throw new AppError(ErrorCode.VALIDATION_FAILED, "获奖人数超过奖项上限。 ");
}

export async function configureCommunityAwardInTx(tx: TxDb, args: AwardPolicy & { awardId: string; actorId: string; reason: string; expectedVersion: number }) {
  const award = await lockAwardInTx(tx, args.awardId);
  assertVersion(award.resultVersion, args.expectedVersion);
  if (!["pending_review", "approved", "awarded", "not_awarded", "cancelled"].includes(award.status)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前奖项不能设置结奖规则。 ");
  if (!args.reason.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写规则设置或更正理由。 ");
  if ((args.recipientPolicy === "single" && args.recipientLimit !== 1) || (args.recipientPolicy === "limited" && (!Number.isInteger(args.recipientLimit) || (args.recipientLimit ?? 0) < 2)) || (args.recipientPolicy === "all_ties" && args.recipientLimit !== null)) throw new AppError(ErrorCode.VALIDATION_FAILED, "获奖人数策略无效。 ");
  const progress = await getCommunityAwardProgress(tx, award.seasonId);
  if (args.settlementPolicy === "stage_complete" ? !progress.stages.some(stage => stage.key === args.settlementStageKey) : args.settlementStageKey !== null) throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择本届正式阶段。 ");
  const recipients = await currentRecipients(tx, award.id);
  assertRecipientCount(args, recipients.length);
  if (award.status === "awarded" && (award.settlementPolicy !== args.settlementPolicy || award.settlementStageKey !== args.settlementStageKey)) {
    const eligible = await eligibleCandidateIds(tx, award.id);
    if (!canSettleCommunityAward(args, progress, "awarded", recipients, eligible)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "新结算策略尚未满足，不能把已公开奖项改为未达成的结算条件。 ");
  }
  const next = { recipientPolicy: args.recipientPolicy, recipientLimit: args.recipientLimit, settlementPolicy: args.settlementPolicy, settlementStageKey: args.settlementStageKey };
  await tx.update(communityAwards).set({ ...next, resultVersion: award.resultVersion + 1, updatedAt: new Date() }).where(eq(communityAwards.id, award.id));
  await writeAuditInTx(tx, { seasonId: award.seasonId, action: "community_award.configure", actorId: args.actorId, targetId: award.id, meta: { previous: { recipientPolicy: award.recipientPolicy, recipientLimit: award.recipientLimit, settlementPolicy: award.settlementPolicy, settlementStageKey: award.settlementStageKey }, next, reason: args.reason } });
  return { seasonId: award.seasonId };
}

export async function verifyCommunityAwardEvidenceInTx(tx: TxDb, args: { awardId: string; evidenceId: string; status: "eligible" | "ineligible"; note: string; actorId: string; expectedVersion: number }) {
  const award = await lockAwardInTx(tx, args.awardId);
  assertVersion(award.resultVersion, args.expectedVersion);
  if (!["approved", "awarded", "not_awarded", "cancelled"].includes(award.status)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前奖项不能核验证据。 ");
  if (!args.note.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "核验或更正必须填写理由。 ");
  const [evidence] = await tx.select().from(communityAwardEvidence).where(and(eq(communityAwardEvidence.id, args.evidenceId), eq(communityAwardEvidence.awardId, award.id))).for("update");
  if (!evidence) throw new AppError(ErrorCode.NOT_FOUND, "候选证据不存在。 ");
  if (args.status === "eligible") {
    if (evidence.candidateUserId && !(await getSeasonAwardCandidates(tx, award.seasonId)).some(candidate => candidate.id === evidence.candidateUserId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "候选人不属于当前赛事相关人员。 ");
    if (evidence.matchId) {
      const [match] = await tx.select({ id: matches.id }).from(matches).where(and(officialMatchCondition(), eq(matches.id, evidence.matchId), eq(matches.seasonId, award.seasonId)));
      if (!match) throw new AppError(ErrorCode.VALIDATION_FAILED, "证据比赛不属于当前赛事。 ");
    }
  }
  const now = new Date();
  await tx.update(communityAwardEvidence).set({ verificationStatus: args.status, verificationNote: args.note, verifiedByUserId: args.actorId, verifiedAt: now }).where(eq(communityAwardEvidence.id, evidence.id));
  await tx.update(communityAwards).set({ resultVersion: award.resultVersion + 1, updatedAt: now }).where(eq(communityAwards.id, award.id));
  await writeAuditInTx(tx, { seasonId: award.seasonId, action: "community_award.evidence.verify", actorId: args.actorId, targetId: evidence.id, meta: { awardId: award.id, previous: { status: evidence.verificationStatus, actorId: evidence.verifiedByUserId, at: evidence.verifiedAt, note: evidence.verificationNote }, next: { status: args.status, actorId: args.actorId, at: now, note: args.note } } });
  return { seasonId: award.seasonId };
}

export async function resolveCommunityAwardInTx(
  tx: TxDb,
  args: { awardId: string; status: Outcome; recipientUserIds?: string[]; recipientUserId?: string | null; outcomeNote: string; actorId: string; expectedVersion: number },
): Promise<{ seasonId: string }> {
  const award = await lockAwardInTx(tx, args.awardId);
  assertVersion(award.resultVersion, args.expectedVersion);
  if (!["approved", "awarded", "not_awarded", "cancelled"].includes(award.status)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有已公开或已结奖社区奖可以记录或更正结果。 ");
  if (!args.outcomeNote.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写结果或更正理由。 ");
  const recipients = args.recipientUserIds ?? (args.recipientUserId ? [args.recipientUserId] : []);
  if (args.recipientUserIds && args.recipientUserId !== undefined) throw new AppError(ErrorCode.VALIDATION_FAILED, "不能同时提供新旧获奖者字段。 ");
  if (args.status === "awarded" ? recipients.length === 0 : recipients.length !== 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "获奖名单与结奖状态不匹配。 ");
  if (new Set(recipients).size !== recipients.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "获奖名单不能包含重复人员。 ");
  assertRecipientCount(award, recipients.length);
  const candidates = new Set((await getSeasonAwardCandidates(tx, award.seasonId)).map(candidate => candidate.id));
  if (recipients.some(id => !candidates.has(id))) throw new AppError(ErrorCode.VALIDATION_FAILED, "获奖者不属于当前赛事相关人员。 ");
  const progress = await getCommunityAwardProgress(tx, award.seasonId);
  const eligible = award.settlementPolicy === "event_verified" ? await eligibleCandidateIds(tx, award.id) : [];
  if (!canSettleCommunityAward(award, progress, args.status, recipients, eligible)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "尚未到达结奖时机，事件奖须先核实获奖者证据。 ");
  const previousRecipients = await currentRecipients(tx, award.id);
  await tx.execute(sql`select set_config('rivalhub.community_awards_writer', 'recipients-v1', true)`);
  await tx.delete(communityAwardRecipients).where(eq(communityAwardRecipients.awardId, award.id));
  if (recipients.length) await tx.insert(communityAwardRecipients).values(recipients.map((userId, position) => ({ awardId: award.id, userId, position })));
  const now = new Date();
  await tx.update(communityAwards).set({ status: args.status, recipientUserId: recipients[0] ?? null, outcomeNote: args.outcomeNote, outcomeByUserId: args.actorId, outcomeAt: now, resultVersion: award.resultVersion + 1, updatedAt: now }).where(eq(communityAwards.id, award.id));
  await tx.execute(sql`select set_config('rivalhub.community_awards_writer', '', true)`);
  await writeAuditInTx(tx, { seasonId: award.seasonId, action: `community_award.${args.status}`, actorId: args.actorId, targetId: award.id, meta: { previousStatus: award.status, status: args.status, previousRecipientUserIds: previousRecipients, recipientUserIds: recipients, previousOutcomeNote: award.outcomeNote, outcomeNote: args.outcomeNote } });
  return { seasonId: award.seasonId };
}

/** Identity merge moves an existing fact; it never re-decides eligibility or timing. */
export async function reparentCommunityAwardRecipientsInTx(tx: TxDb, args: { canonicalUserId: string; mergedUserId: string; actorId: string }) {
  const affected = await tx.select({ awardId: communityAwardRecipients.awardId }).from(communityAwardRecipients).where(eq(communityAwardRecipients.userId, args.mergedUserId));
  if (!affected.length) return;
  const awards = await tx.select().from(communityAwards).where(inArray(communityAwards.id, affected.map(row => row.awardId))).orderBy(asc(communityAwards.id)).for("update");
  for (const award of awards) {
    const previous = await currentRecipients(tx, award.id);
    const next = [...new Set(previous.map(id => id === args.mergedUserId ? args.canonicalUserId : id))];
    await tx.execute(sql`select set_config('rivalhub.community_awards_writer', 'recipients-v1', true)`);
    await tx.delete(communityAwardRecipients).where(eq(communityAwardRecipients.awardId, award.id));
    await tx.insert(communityAwardRecipients).values(next.map((userId, position) => ({ awardId: award.id, userId, position })));
    await tx.update(communityAwards).set({ recipientUserId: next[0], resultVersion: award.resultVersion + 1, updatedAt: new Date() }).where(eq(communityAwards.id, award.id));
    await tx.execute(sql`select set_config('rivalhub.community_awards_writer', '', true)`);
    await writeAuditInTx(tx, { seasonId: award.seasonId, action: "community_award.recipient.merge", targetId: award.id, actorId: args.actorId, meta: { previousRecipientUserIds: previous, recipientUserIds: next, canonicalUserId: args.canonicalUserId, mergedUserId: args.mergedUserId } });
  }
}
