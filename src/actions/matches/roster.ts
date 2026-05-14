"use server";

import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { matchRosters, matchRosterPlayers, teamMembers, seasons, auditLogs } from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { getMatchOrThrow, actionError } from "@/lib/action-utils";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { getTeamIdForCaptain } from "./_shared";

/**
 * 队长提交比赛名单（5 首发 + 0~2 替补）。
 * - 比赛状态需为 scheduled 或 in_progress
 * - 队长身份校验
 * - 队员必须属于本队
 * - 距开赛不足 2 小时锁定
 * - 已 submitted 的名单需管理员 unlock 后才能重新提交
 */
export async function submitMatchRoster(
  matchId: string,
  starterIds: string[],
  substituteIds: string[] = [],
): Promise<ActionResult<{ rosterId: string }>> {
  try {
    const session = await requireAuth();
    const match = await getMatchOrThrow(matchId);

    if (match.status !== "scheduled" && match.status !== "in_progress") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛状态不允许提交名单");
    }

    const teamId = await getTeamIdForCaptain(session.userId, match);
    if (!teamId) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以提交名单");
    }

    if (starterIds.length !== 5) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "必须选择 5 名首发");
    }
    if (substituteIds.length > 2) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "替补不能超过 2 人");
    }

    // 验证所有队员属于本队
    const allIds = [...starterIds, ...substituteIds];
    const memberRows = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId));
    const memberIdSet = new Set(memberRows.map((r) => r.id));
    for (const id of allIds) {
      if (!memberIdSet.has(id)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "队员不属于本队");
      }
    }

    // 2 小时窗口检查
    if (match.scheduledAt) {
      const hoursUntilMatch =
        (match.scheduledAt.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilMatch < 2) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "距开赛不足 2 小时，无法提交名单");
      }
    }

    const rosterId = await db.transaction(async (tx) => {
      const existing = await tx.query.matchRosters.findFirst({
        where: and(
          eq(matchRosters.matchId, matchId),
          eq(matchRosters.teamId, teamId),
        ),
      });
      if (existing && existing.status === "submitted") {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "名单已锁定，联系管理员解锁");
      }

      let rosterId: string;
      if (existing) {
        rosterId = existing.id;
        await tx
          .update(matchRosters)
          .set({ status: "submitted", lockedAt: new Date(), updatedAt: new Date() })
          .where(eq(matchRosters.id, existing.id));
        await tx
          .delete(matchRosterPlayers)
          .where(eq(matchRosterPlayers.rosterId, existing.id));
      } else {
        const [row] = await tx
          .insert(matchRosters)
          .values({ matchId, teamId, submittedBy: session.userId })
          .returning({ id: matchRosters.id });
        rosterId = row.id;
      }

      const playerRows = [
        ...starterIds.map((id) => ({ rosterId, teamMemberId: id, isStarter: true })),
        ...substituteIds.map((id) => ({ rosterId, teamMemberId: id, isStarter: false })),
      ];
      await tx.insert(matchRosterPlayers).values(playerRows);

      return rosterId;
    });

    await db.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.submit_roster",
      actorId: session.userId,
      targetId: rosterId,
      targetType: "match_roster",
      meta: { matchId, teamId, starters: starterIds.length, substitutes: substituteIds.length },
    });

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
    });
    if (season) revalidateMatchPaths(season.slug, matchId);

    return ok({ rosterId });
  } catch (e) {
    return actionError("submitMatchRoster", e);
  }
}

/**
 * 管理员解锁名单，允许队长重新提交。
 */
export async function unlockMatchRoster(
  rosterId: string,
): Promise<ActionResult<void>> {
  try {
    const roster = await db.query.matchRosters.findFirst({
      where: eq(matchRosters.id, rosterId),
    });
    if (!roster) {
      throw new AppError(ErrorCode.NOT_FOUND, ERROR_MESSAGES.NOT_FOUND);
    }

    const match = await getMatchOrThrow(roster.matchId);
    const admin = await requireSeasonAdmin(match.seasonId);

    await db
      .update(matchRosters)
      .set({ status: "unlocked", updatedAt: new Date() })
      .where(eq(matchRosters.id, rosterId));

    await db.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.unlock_roster",
      actorId: admin.email,
      targetId: rosterId,
      targetType: "match_roster",
      meta: { matchId: roster.matchId, teamId: roster.teamId },
    });

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
    });
    if (season) revalidateMatchPaths(season.slug, roster.matchId);

    return ok(undefined);
  } catch (e) {
    return actionError("unlockMatchRoster", e);
  }
}

/**
 * 查询某场比赛的名单（含首发/替补队员）。
 */
export async function getMatchRoster(matchId: string, teamId: string) {
  const roster = await db.query.matchRosters.findFirst({
    where: and(
      eq(matchRosters.matchId, matchId),
      eq(matchRosters.teamId, teamId),
    ),
  });
  if (!roster) return null;

  const players = await db.query.matchRosterPlayers.findMany({
    where: eq(matchRosterPlayers.rosterId, roster.id),
  });

  return { ...roster, players };
}
