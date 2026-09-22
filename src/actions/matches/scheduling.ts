"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, matchTimeProposals, matches, seasons } from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { getMatchOrThrow, getSeasonOrThrow, actionError } from "@/lib/action-utils";
import { revalidateMatchPaths } from "@/lib/revalidation";
import {
  assertBeforeTimeConfirmationCutoff,
  assertProposedTimeFitsDeadline,
  getTimeBufferHoursForStage,
} from "@/lib/matches/time-rules";
import { getEntryIdForRepresentative } from "./_shared";
import { lockMatchInTx } from "@/lib/match-rosters/service";

/**
 * 队长提议比赛时间。
 * 条件：比赛状态为 scheduled，且当前用户是参赛队伍之一的队长。
 */
export async function proposeMatchTime(
  matchId: string,
  proposedTime: Date,
): Promise<ActionResult<{ proposalId: string }>> {
  try {
    const session = await requireAuth();
    const match = await getMatchOrThrow(matchId);

    if (match.status !== "scheduled") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "只能在 scheduled 状态下提议时间");
    }
    const season = await getSeasonOrThrow(match.seasonId);
    const bufferHours = getTimeBufferHoursForStage(season.stagePlan, match.stage);
    assertBeforeTimeConfirmationCutoff(match.completionDeadline, bufferHours);
    assertProposedTimeFitsDeadline(proposedTime, match.completionDeadline);

    if (!(await getEntryIdForRepresentative(session.userId, match))) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以提议时间");
    }

    const [proposal] = await db
      .insert(matchTimeProposals)
      .values({
        matchId,
        proposedBy: session.userId,
        proposedTime,
      })
      .returning({ id: matchTimeProposals.id });

    await writeAuditInTx(db, {
      seasonId: match.seasonId,
      action: "match.propose_time",
      actorId: session.userId,
      targetId: matchId,meta: { proposalId: proposal.id, proposedTime: proposedTime.toISOString() },
    });

    revalidateMatchPaths(season.slug, matchId);

    return ok({ proposalId: proposal.id });
  } catch (e) {
    return actionError("proposeMatchTime", e);
  }
}

/**
 * 对方队长响应时间提议。
 * - accept：接受提议，同时更新 matches.scheduledAt
 * - reject：拒绝提议，必须填写理由（≤200 字符）
 */
export async function respondToTimeProposal(
  proposalId: string,
  action: "accept" | "reject",
  rejectReason?: string,
): Promise<ActionResult<void>> {
  try {
    const session = await requireAuth();
    const outcome = await db.transaction(async (tx) => {
      const [proposal] = await tx.select().from(matchTimeProposals)
        .where(eq(matchTimeProposals.id, proposalId)).for("update");
      if (!proposal) throw new AppError(ErrorCode.NOT_FOUND, "提议不存在");
      if (proposal.status !== "pending") throw new AppError(ErrorCode.VALIDATION_FAILED, "提议已失效");
      const match = await lockMatchInTx(tx, proposal.matchId);
      const [season] = await tx.select().from(seasons).where(eq(seasons.id, match.seasonId));
      if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
      const bufferHours = getTimeBufferHoursForStage(season.stagePlan, match.stage);
      assertBeforeTimeConfirmationCutoff(match.completionDeadline, bufferHours);
      if (action === "accept") assertProposedTimeFitsDeadline(proposal.proposedTime, match.completionDeadline);
      if (proposal.proposedBy === session.userId) throw new AppError(ErrorCode.FORBIDDEN, "不能回应自己的提议");
      const [captain] = await tx.select({ id: competitionEntries.id }).from(competitionEntries).where(and(
        eq(competitionEntries.representativeUserId, session.userId),
        eq(competitionEntries.competitionId, match.seasonId),
        or(eq(competitionEntries.id, match.entryAId), eq(competitionEntries.id, match.entryBId)),
      ));
      if (!captain) throw new AppError(ErrorCode.FORBIDDEN, "只有对方队长可以回应");
      const updates: Record<string, unknown> = {
        status: action === "accept" ? "accepted" : "rejected",
        responseAt: new Date(),
        updatedAt: new Date(),
      };
      if (action === "reject") {
        if (!rejectReason || rejectReason.trim().length === 0) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, "拒绝时必须填写原因");
        }
        updates.rejectReason = rejectReason.trim().slice(0, 200);
      }
      await tx
        .update(matchTimeProposals)
        .set(updates)
        .where(eq(matchTimeProposals.id, proposalId));

      if (action === "accept") {
        await tx
          .update(matches)
          .set({ scheduledAt: proposal.proposedTime, updatedAt: new Date() })
          .where(eq(matches.id, match.id));
        await tx
          .update(matchTimeProposals)
          .set({ status: "expired", updatedAt: new Date() })
          .where(
            and(
              eq(matchTimeProposals.matchId, match.id),
              eq(matchTimeProposals.status, "pending"),
            ),
          );
      }
      return { seasonSlug: season.slug, matchId: match.id, seasonId: match.seasonId };
    });

    await writeAuditInTx(db, {
      seasonId: outcome.seasonId,
      action: "match.respond_time_proposal",
      actorId: session.userId,
      targetId: proposalId,meta: { matchId: outcome.matchId, action, rejectReason: rejectReason ?? null },
    });

    revalidateMatchPaths(outcome.seasonSlug, outcome.matchId);
    return ok(undefined);
  } catch (e) {
    return actionError("respondToTimeProposal", e);
  }
}

/**
 * 管理员强制设定比赛时间。
 * 自动将同场比赛所有 pending 提议设为 expired，并创建一条 accepted 记录写入审计。
 */
export async function forceSetMatchTime(
  matchId: string,
  time: Date,
): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    assertProposedTimeFitsDeadline(time, match.completionDeadline);

    await db.transaction(async (tx) => {
      await tx
        .update(matchTimeProposals)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(matchTimeProposals.matchId, matchId),
            eq(matchTimeProposals.status, "pending"),
          ),
        );
      await tx.insert(matchTimeProposals).values({
        matchId,
        proposedBy: admin.userId,
        forceAssignedBy: admin.userId,
        status: "accepted",
        proposedTime: time,
        responseAt: new Date(),
      });
      await tx
        .update(matches)
        .set({ scheduledAt: time, updatedAt: new Date() })
        .where(eq(matches.id, matchId));
      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "match.force_set_time",
        actorId: admin.email,
        targetId: matchId,meta: { scheduledAt: time.toISOString() },
      });
    });

    const season = await getSeasonOrThrow(match.seasonId);
    revalidateMatchPaths(season.slug, matchId);
    return ok(undefined);
  } catch (e) {
    return actionError("forceSetMatchTime", e);
  }
}
