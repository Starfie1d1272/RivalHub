"use server";

import { eq, and, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { matchTimeProposals, matches, auditLogs, seasons } from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { getMatchOrThrow, getSeasonOrThrow, actionError } from "@/lib/action-utils";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { getTeamIdForCaptain } from "./_shared";

const TIME_CONFIRMATION_BUFFER_HOURS = 24;

export interface MatchTimeAutoAwardCronSummary {
  processed: number;
  awarded: number;
  skipped: number;
  failed: number;
}

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
    assertBeforeTimeConfirmationCutoff(match.completionDeadline);
    assertProposedTimeFitsDeadline(proposedTime, match.completionDeadline);

    if (!(await getTeamIdForCaptain(session.userId, match))) {
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

    await db.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.propose_time",
      actorId: session.userId,
      targetId: matchId,
      targetType: "match",
      meta: { proposalId: proposal.id, proposedTime: proposedTime.toISOString() },
    });

    const season = await getSeasonOrThrow(match.seasonId);
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

    const proposal = await db.query.matchTimeProposals.findFirst({
      where: eq(matchTimeProposals.id, proposalId),
    });
    if (!proposal) {
      throw new AppError(ErrorCode.NOT_FOUND, "提议不存在");
    }
    if (proposal.status !== "pending") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "提议已失效");
    }

    const match = await getMatchOrThrow(proposal.matchId);
    assertBeforeTimeConfirmationCutoff(match.completionDeadline);
    if (action === "accept") {
      assertProposedTimeFitsDeadline(proposal.proposedTime, match.completionDeadline);
    }

    if (proposal.proposedBy === session.userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "不能回应自己的提议");
    }
    if (!(await getTeamIdForCaptain(session.userId, match))) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有对方队长可以回应");
    }

    await db.transaction(async (tx) => {
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

        // 过期同场比赛所有其他 pending 提议
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
    });

    await db.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.respond_time_proposal",
      actorId: session.userId,
      targetId: proposalId,
      targetType: "match_time_proposal",
      meta: { matchId: match.id, action, rejectReason: rejectReason ?? null },
    });

    const season = await getSeasonOrThrow(match.seasonId);
    revalidateMatchPaths(season.slug, proposal.matchId);

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
      // 过期所有 pending 提议
      await tx
        .update(matchTimeProposals)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(matchTimeProposals.matchId, matchId),
            eq(matchTimeProposals.status, "pending"),
          ),
        );

      // 创建强制指定记录
      await tx.insert(matchTimeProposals).values({
        matchId,
        proposedBy: admin.userId,
        forceAssignedBy: admin.userId,
        status: "accepted",
        proposedTime: time,
        responseAt: new Date(),
      });

      // 更新比赛时间
      await tx
        .update(matches)
        .set({ scheduledAt: time, updatedAt: new Date() })
        .where(eq(matches.id, matchId));

      // 审计
      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.force_set_time",
        actorId: admin.email,
        targetId: matchId,
        targetType: "match",
        meta: { scheduledAt: time.toISOString() },
      });
    });

    const season = await getSeasonOrThrow(match.seasonId);
    revalidateMatchPaths(season.slug, matchId);

    return ok(undefined);
  } catch (e) {
    return actionError("forceSetMatchTime", e);
  }
}

/**
 * 协商截止后自动采用最早创建的 pending 时间提议。
 */
export async function runMatchTimeAutoAwardCron(
  now = new Date(),
): Promise<MatchTimeAutoAwardCronSummary> {
  const cutoffThreshold = new Date(
    now.getTime() + TIME_CONFIRMATION_BUFFER_HOURS * 60 * 60 * 1000,
  );

  const candidateMatches = await db.query.matches.findMany({
    where: and(
      eq(matches.status, "scheduled"),
      isNull(matches.scheduledAt),
      isNotNull(matches.completionDeadline),
      lte(matches.completionDeadline, cutoffThreshold),
    ),
  });

  const settled = await Promise.allSettled(
    candidateMatches.map(async (match) => {
      const result = await autoAwardMatchTime(match.id, now);
      return { matchId: match.id, result };
    }),
  );

  let awarded = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of settled) {
    if (item.status === "rejected") {
      failed += 1;
      continue;
    }
    const { matchId, result } = item.value;
    if (result.awarded) {
      awarded += 1;
      revalidateMatchPaths(result.seasonSlug, matchId);
    } else {
      skipped += 1;
    }
  }

  return { processed: candidateMatches.length, awarded, skipped, failed };
}

/**
 * 查询某场比赛的所有时间提议（按创建时间倒序）。
 */
export async function getTimeProposals(matchId: string) {
  return db.query.matchTimeProposals.findMany({
    where: eq(matchTimeProposals.matchId, matchId),
    orderBy: (tps, { desc }) => [desc(tps.createdAt)],
  });
}

async function autoAwardMatchTime(
  matchId: string,
  now: Date,
): Promise<{ awarded: true; seasonSlug: string } | { awarded: false }> {
  return db.transaction(async (tx) => {
    const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
    if (!match || match.status !== "scheduled" || match.scheduledAt || !match.completionDeadline) {
      return { awarded: false };
    }

    const cutoff = getTimeConfirmationCutoff(match.completionDeadline);
    if (!cutoff || now.getTime() < cutoff.getTime()) {
      return { awarded: false };
    }

    const proposal = await tx.query.matchTimeProposals.findFirst({
      where: and(
        eq(matchTimeProposals.matchId, match.id),
        eq(matchTimeProposals.status, "pending"),
      ),
      orderBy: (tps, { asc }) => [asc(tps.createdAt)],
    });
    if (!proposal) {
      return { awarded: false };
    }

    const season = await tx.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
    });
    if (!season) {
      return { awarded: false };
    }

    await tx
      .update(matches)
      .set({ scheduledAt: proposal.proposedTime, updatedAt: now })
      .where(eq(matches.id, match.id));

    await tx
      .update(matchTimeProposals)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(matchTimeProposals.matchId, match.id),
          eq(matchTimeProposals.status, "pending"),
        ),
      );

    await tx
      .update(matchTimeProposals)
      .set({ status: "accepted", responseAt: now, updatedAt: now })
      .where(eq(matchTimeProposals.id, proposal.id));

    await tx.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.auto_award_time",
      actorId: "system",
      targetId: match.id,
      targetType: "match",
      meta: {
        proposalId: proposal.id,
        proposedBy: proposal.proposedBy,
        scheduledAt: proposal.proposedTime.toISOString(),
      },
    });

    return { awarded: true, seasonSlug: season.slug };
  });
}

function getTimeConfirmationCutoff(
  completionDeadline: Date | null,
): Date | null {
  if (!completionDeadline) return null;
  return new Date(completionDeadline.getTime() - TIME_CONFIRMATION_BUFFER_HOURS * 60 * 60 * 1000);
}

function assertBeforeTimeConfirmationCutoff(completionDeadline: Date | null): void {
  const cutoff = getTimeConfirmationCutoff(completionDeadline);
  if (cutoff && Date.now() >= cutoff.getTime()) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      "时间协商已截止，请联系管理员指定比赛时间",
    );
  }
}

function assertProposedTimeFitsDeadline(
  proposedTime: Date,
  completionDeadline: Date | null,
): void {
  if (Number.isNaN(proposedTime.getTime())) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "请输入有效的比赛时间");
  }
  if (proposedTime.getTime() <= Date.now()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛时间必须晚于当前时间");
  }
  if (completionDeadline && proposedTime.getTime() > completionDeadline.getTime()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛时间不能晚于最晚完成时间");
  }
}
