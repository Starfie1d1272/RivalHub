import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  competitionEntries,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  eventRosters,
  majorPrestartEntrants,
  seasons,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { getRegistrationWindowState } from "@/lib/registration/window";

/**
 * Canonical approved-roster change transition: the Entry representative reopens
 * an approved Entry into remediation. The full order is season →
 * CompetitionEntry → eventRoster → prestart entrant, matching the prestart
 * coherence guard; within the roster-remediation aggregate it remains Entry →
 * eventRoster → entrant, so a concurrent prestart freeze can serialise instead
 * of deadlocking.
 */
export async function requestCompetitionEntryRosterChangeInTx(
  tx: TxDb,
  input: { entryId: string; representativeUserId: string; actorId: string },
): Promise<{ seasonSlug: string }> {
  // The Entry id is the only input, so derive the season before taking the
  // aggregate locks. The season lock is needed before Entry because the
  // atomic audit insert below references seasons; this keeps the full order
  // compatible with Major start/save while preserving Entry → eventRoster →
  // prestart entrant within the roster-remediation aggregate.
  const [entryScope] = await tx.select({ competitionId: competitionEntries.competitionId })
    .from(competitionEntries).where(eq(competitionEntries.id, input.entryId));
  if (!entryScope) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
  const [season] = await tx.select({ slug: seasons.slug, status: seasons.status, startAt: seasons.startAt, registrationDeadline: seasons.registrationDeadline })
    .from(seasons).where(eq(seasons.id, entryScope.competitionId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。");
  const [entry] = await tx.select().from(competitionEntries)
    .where(eq(competitionEntries.id, input.entryId)).for("update");
  if (!entry) throw new AppError(ErrorCode.NOT_FOUND, "赛事参赛条目不存在。");
  if (entry.representativeUserId !== input.representativeUserId) throw new AppError(ErrorCode.FORBIDDEN, "只有本届赛事负责人可以执行此操作。");
  if (entry.registrationStatus !== "approved" || entry.approvedRosterRevisionId === null) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只有已批准 Entry 可以发起 roster change。");
  const [prestartRoster] = await tx.select({ id: eventRosters.id, status: eventRosters.status }).from(eventRosters).where(eq(eventRosters.entryId, entry.id)).for("update");
  if (prestartRoster?.status === "frozen") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "event roster 已冻结；名单变化必须走赛事运营裁决，不能回写报名事实。");
  let prestartInvalidated = false;
  if (prestartRoster) {
    // 重新进入补正后，未冻结的赛前名单回到待同步/待确认状态，旧审批事实不再继续向上传递。
    await tx.update(eventRosters).set({ status: "preparing", confirmedAt: null, confirmedBy: null, frozenAt: null, frozenBy: null, updatedAt: new Date() }).where(eq(eventRosters.id, prestartRoster.id));
    await tx.update(majorPrestartEntrants).set({ rosterConfirmedAt: null, rosterConfirmedBy: null, updatedAt: new Date() })
      .where(eq(majorPrestartEntrants.eventRosterId, prestartRoster.id));
    prestartInvalidated = true;
  }
  if (!getRegistrationWindowState(season).canSubmit) throw new AppError(ErrorCode.REGISTRATION_CLOSED, "报名窗口已关闭；请联系赛事管理员发起名单变更。");
  const [approved] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.approvedRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!approved) throw new AppError(ErrorCode.INTERNAL_ERROR, "已批准 roster revision 不存在。");
  const [current] = await tx.select().from(competitionEntryRosterRevisions).where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id))).for("update");
  if (!current) throw new AppError(ErrorCode.INTERNAL_ERROR, "当前 roster revision 不存在。");
  const nextRevision = current.revisionNumber + 1;
  const [next] = await tx.insert(competitionEntryRosterRevisions).values({ entryId: entry.id, revisionNumber: nextRevision, status: "draft", createdBy: input.actorId }).returning({ id: competitionEntryRosterRevisions.id });
  const members = await tx.select().from(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, approved.id));
  if (members.length > 0) await tx.insert(competitionEntryRosterMembers).values(members.map((member) => ({ revisionId: next.id, participantId: member.participantId, userId: member.userId, teamMembershipId: member.teamMembershipId, isPrimaryStarter: member.isPrimaryStarter })));
  await tx.update(competitionEntries).set({ registrationStatus: "changes_requested", currentRosterRevisionId: next.id, reviewReason: "Entry representative requested an approved-roster change", updatedAt: new Date() }).where(eq(competitionEntries.id, entry.id));
  await tx.insert(auditLogs).values({ seasonId: entry.competitionId, action: "competition_entry.roster_change.request", actorId: input.actorId, targetId: entry.id, targetType: "competition_entry", meta: { approvedRevision: approved.revisionNumber, nextRevision, prestartInvalidated } });
  return { seasonSlug: season.slug };
}
