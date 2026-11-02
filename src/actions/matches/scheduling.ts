"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matchTimeProposals, matches, seasons } from "@/db/schema";
import { z } from "zod";
import { getReadbackMatchOrThrow } from "@/lib/matches/readback-scope";
import { timeReadbackVersion, type TimeReadback } from "@/lib/matches/operation-readback";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { getMatchOrThrow, getSeasonOrThrow, actionError } from "@/lib/action-utils";
import { captureException } from "@/lib/observability/server";
import { revalidateMatchPaths } from "@/lib/revalidation";
import {
  assertProposedTimeFitsDeadline,
} from "@/lib/matches/time-rules";
import { getEntryIdForRepresentative } from "./_shared";
import { proposeTime, respondToProposal, setAdminSchedule } from "@/lib/matches/scheduling";

/**
 * 队长提议比赛时间。
 * 条件：比赛状态为 scheduled，且当前用户是参赛队伍之一的队长。
 */
export async function proposeMatchTime(
  matchId: string,
  proposedTime: Date,
  coverageSlotId?: string,
): Promise<ActionResult<{ proposalId: string }>> {
  try {
    const session = await requireAuth();
    const match = await getMatchOrThrow(matchId);

    if (match.status !== "scheduled") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "只能为尚未开始的比赛提议时间");
    }
    const season = await getSeasonOrThrow(match.seasonId);
    assertProposedTimeFitsDeadline(proposedTime, match.completionDeadline);

    if (!(await getEntryIdForRepresentative(session.userId, match))) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以提议时间");
    }

    const proposal = await proposeTime(matchId, match.seasonId, session.userId, proposedTime, coverageSlotId);

    revalidateMatchPaths(season.slug, matchId, { statistics: false });

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
): Promise<ActionResult<{ refreshPending: boolean }>> {
  try {
    const session = await requireAuth();
    const outcome = await respondToProposal(proposalId, session.userId, action, rejectReason);

    let refreshPending = false;
    try { revalidateMatchPaths(outcome.seasonSlug, outcome.matchId, { statistics: false }); }
    catch (error) {
      refreshPending = true;
      captureException("action.scheduling_refresh_failure", error, { scope: "action", operation: "scheduling.refresh" });
    }
    return ok({ refreshPending });
  } catch (e) {
    return actionError("respondToTimeProposal", e);
  }
}

/**
 * 管理员强制设定比赛时间。
 * 设定时记录管理员来源；清空也结束待回应提议并释放转播资源。
 */
export async function forceSetMatchTime(
  matchId: string,
  time: Date | null,
): Promise<ActionResult<void>> {
  try {
    return await saveAdminSchedule(matchId, time, "force");

  } catch (e) {
    return actionError("forceSetMatchTime", e);
  }
}

/** Recovery requires current representative or season-admin authority, not an old viewer flag. */
export async function getTimeProposalReadback(proposalId: string): Promise<ActionResult<TimeReadback>> {
  try {
    if (!z.uuid().safeParse(proposalId).success) throw new AppError(ErrorCode.VALIDATION_FAILED, "提议编号无效。");
    const session = await requireAuth();
    const candidate = await db.query.matchTimeProposals.findFirst({ where: eq(matchTimeProposals.id, proposalId), columns: { matchId: true } });
    if (!candidate) throw new AppError(ErrorCode.NOT_FOUND, "提议不存在。");
    const match = await getReadbackMatchOrThrow(candidate.matchId);
    if (!await getEntryIdForRepresentative(session.userId, match)) await requireSeasonAdmin(match.seasonId);
    const [row] = await db.select({ proposalId: matchTimeProposals.id, status: matchTimeProposals.status, resolution: matchTimeProposals.resolution,
      proposedTime: matchTimeProposals.proposedTime, scheduledAt: matches.scheduledAt, rejectReason: matchTimeProposals.rejectReason })
      .from(matchTimeProposals).innerJoin(matches, eq(matches.id, matchTimeProposals.matchId))
      .where(and(eq(matchTimeProposals.id, proposalId), eq(matches.id, match.id), eq(matches.seasonId, match.seasonId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "提议范围已变化，请重新读取。");
    const value = { ...row, proposedTime: row.proposedTime.toISOString(), scheduledAt: row.scheduledAt?.toISOString() ?? null };
    return ok({ matchId: match.id, value, version: await timeReadbackVersion(match.id, value) });
  } catch (error) { return actionError("getTimeProposalReadback", error); }
}
export async function retryTimeProposalRefresh(proposalId: string): Promise<ActionResult<void>> {
  try {
    const read = await getTimeProposalReadback(proposalId);
    if (!read.success) return read;
    const match = await getReadbackMatchOrThrow(read.data.matchId);
    const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, match.seasonId));
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛事不存在。");
    revalidateMatchPaths(season.slug, match.id, { statistics: false });
    return ok(undefined);
  } catch (error) { return actionError("retryTimeProposalRefresh", error); }
}

export async function setMatchScheduledAt(matchId: string, time: Date | null): Promise<ActionResult<void>> {
  return saveAdminSchedule(matchId, time, "save");
}

async function saveAdminSchedule(matchId: string, time: Date | null, intent: "save" | "force"): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    await setAdminSchedule(matchId, match.seasonId, admin.userId, admin.email, time, intent);
    const season = await getSeasonOrThrow(match.seasonId);
    revalidateMatchPaths(season.slug, matchId, { statistics: false });
    return ok(undefined);
  } catch (error) { return actionError("setMatchScheduledAt", error); }
}
