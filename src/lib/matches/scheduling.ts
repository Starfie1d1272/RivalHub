import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { competitionEntries, matchTimeProposals, matches, seasons } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { assertProposedTimeFitsDeadline } from "./time-rules";
import { holdCoverageInTx, allocateHeldCoverageInTx, releaseMatchCoverageHoldInTx, releaseMatchCoverageInTx } from "./coverage";
import { lockCompetitionMatchInTx as lockMatchInTx } from "./locking";
import { proposingEntryId } from "./time-proposal-side";

export async function proposeTime(matchId: string, seasonId: string, userId: string, proposedTime: Date, coverageSlotId?: string) {
  return db.transaction(async tx => {
      const locked = await lockMatchInTx(tx, matchId);
      if (locked.seasonId !== seasonId) throw new AppError(ErrorCode.FORBIDDEN, "比赛所属赛事已变化。");
      if (locked.status !== "scheduled") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已经开始，不能更改时间。");
      const [representative] = await tx.select({ id: competitionEntries.id }).from(competitionEntries).where(and(
        eq(competitionEntries.competitionId, locked.seasonId),
        eq(competitionEntries.representativeUserId, userId),
        or(eq(competitionEntries.id, locked.entryAId), eq(competitionEntries.id, locked.entryBId)),
      )).for("update");
      if (!representative) throw new AppError(ErrorCode.FORBIDDEN, "只有本届队长可以提议时间");
      assertProposedTimeFitsDeadline(proposedTime, locked.completionDeadline);
      await tx.update(matchTimeProposals).set({ status: "expired", updatedAt: new Date() }).where(and(eq(matchTimeProposals.matchId, matchId), eq(matchTimeProposals.status, "pending")));
      if (coverageSlotId) await holdCoverageInTx(tx, locked, coverageSlotId, proposedTime);
      else await releaseMatchCoverageHoldInTx(tx, matchId);
      assertProposedTimeFitsDeadline(proposedTime, locked.completionDeadline);
      const [created] = await tx.insert(matchTimeProposals).values({ matchId, proposedBy: userId, proposedByEntryId: representative.id, proposedTime,
        // The full response window starts after authorization/resource waits.
        createdAt: sql`clock_timestamp()`,
      }).returning({ id: matchTimeProposals.id });
      await writeAuditInTx(tx, { seasonId: seasonId, action: "match.propose_time", actorId: userId, targetId: matchId, meta: { proposalId: created.id, proposedTime: proposedTime.toISOString() } });
      return created;
    });
}

export async function respondToProposal(proposalId: string, userId: string, action: "accept" | "reject", rejectReason?: string) {
  return db.transaction(async (tx) => {
      const candidate = await tx.query.matchTimeProposals.findFirst({ where: eq(matchTimeProposals.id, proposalId), columns: { matchId: true } });
      if (!candidate) throw new AppError(ErrorCode.NOT_FOUND, "提议不存在");
      const match = await lockMatchInTx(tx, candidate.matchId);
      if (match.status !== "scheduled") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已经开始。");
      const [proposal] = await tx.select().from(matchTimeProposals)
        .where(eq(matchTimeProposals.id, proposalId)).for("update");
      if (!proposal) throw new AppError(ErrorCode.NOT_FOUND, "提议不存在");
      if (proposal.status !== "pending") throw new AppError(ErrorCode.VALIDATION_FAILED, "提议已失效");
      const [season] = await tx.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, match.seasonId));
      if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
      if (action === "accept") assertProposedTimeFitsDeadline(proposal.proposedTime, match.completionDeadline);
      if (proposal.proposedBy === userId) throw new AppError(ErrorCode.FORBIDDEN, "不能回应自己的提议");
      const [captain] = await tx.select({ id: competitionEntries.id }).from(competitionEntries).where(and(
        eq(competitionEntries.representativeUserId, userId),
        eq(competitionEntries.competitionId, match.seasonId),
        or(eq(competitionEntries.id, match.entryAId), eq(competitionEntries.id, match.entryBId)),
      )).for("update");
      if (!captain) throw new AppError(ErrorCode.FORBIDDEN, "只有对方队长可以回应");
      const [side] = await tx.select({ entryId: proposingEntryId() }).from(matchTimeProposals)
        .innerJoin(matches, eq(matches.id, matchTimeProposals.matchId)).where(eq(matchTimeProposals.id, proposal.id));
      if (!side?.entryId || side.entryId === captain.id) throw new AppError(ErrorCode.FORBIDDEN, "只有提议方的对手队长可以回应；无法确认来源的旧提议请重新发起。");
      // Authorization may wait for a representative handover; validate time again.
      if (action === "accept") assertProposedTimeFitsDeadline(proposal.proposedTime, match.completionDeadline);
      if (action === "accept") {
        await allocateHeldCoverageInTx(tx, match.id, proposal.proposedTime);
        assertProposedTimeFitsDeadline(proposal.proposedTime, match.completionDeadline);
        await acceptProposalInTx(tx, match.id, proposal.id, proposal.proposedTime, "participant_accept", new Date());
      } else {
        if (!rejectReason || rejectReason.trim().length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "拒绝时必须填写原因");
        await tx.update(matchTimeProposals).set({ status: "rejected", resolution: null, responseAt: new Date(), updatedAt: new Date(), rejectReason: rejectReason.trim().slice(0, 200) }).where(eq(matchTimeProposals.id, proposalId));
        await releaseMatchCoverageHoldInTx(tx, match.id);
      }
      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "match.respond_time_proposal",
        actorId: userId,
        targetId: proposalId,
        meta: { matchId: match.id, action, rejectReason: rejectReason ?? null },
      });
      return { seasonSlug: season.slug, matchId: match.id };
    });
}

/** All admin entrypoints use the same locked transition, including clearing. */
export async function setAdminSchedule(matchId: string, seasonId: string, userId: string, actorId: string, time: Date | null) {
  await db.transaction(async tx => {
    const match = await lockMatchInTx(tx, matchId);
    if (match.seasonId !== seasonId) throw new AppError(ErrorCode.FORBIDDEN, "比赛所属赛事已变化。");
    if (match.status !== "scheduled") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只能调整尚未开始的比赛时间。");
    if (time) assertProposedTimeFitsDeadline(time, match.completionDeadline);
    await releaseMatchCoverageInTx(tx, matchId);
    // Resource rows can wait; reject a time that became invalid during the wait.
    if (time) assertProposedTimeFitsDeadline(time, match.completionDeadline);
    await tx.update(matchTimeProposals).set({ status: "expired", updatedAt: new Date() }).where(and(eq(matchTimeProposals.matchId, matchId), eq(matchTimeProposals.status, "pending")));
    if (time) assertProposedTimeFitsDeadline(time, match.completionDeadline);
    if (time) await tx.insert(matchTimeProposals).values({ matchId, proposedBy: userId, forceAssignedBy: userId, status: "accepted", resolution: "admin_force", proposedTime: time, responseAt: new Date() });
    await tx.update(matches).set({ scheduledAt: time, updatedAt: new Date() }).where(eq(matches.id, matchId));
    await writeAuditInTx(tx, { seasonId, action: "match.force_set_time", actorId, targetId: matchId, meta: { scheduledAt: time?.toISOString() ?? null } });
  });
}

/** Caller holds the match lock and has validated the acceptance after resource waits. */
export async function acceptProposalInTx(tx: TxDb, matchId: string, proposalId: string, time: Date, resolution: "participant_accept" | "auto_timeout", now: Date) {
  await tx.update(matchTimeProposals).set({ status: "accepted", resolution, responseAt: now, updatedAt: now }).where(eq(matchTimeProposals.id, proposalId));
  await tx.update(matchTimeProposals).set({ status: "expired", updatedAt: now }).where(and(eq(matchTimeProposals.matchId, matchId), eq(matchTimeProposals.status, "pending")));
  await tx.update(matches).set({ scheduledAt: time, updatedAt: now }).where(eq(matches.id, matchId));
}
