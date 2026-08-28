"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditLogs,
  matchRosterPlayers,
  matchRosters,
  seasons,
} from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireAuth, requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { getMatchOrThrow, actionError } from "@/lib/action-utils";
import { revalidateMatchPaths } from "@/lib/revalidation";
import type { Match } from "@/db/schema";
import {
  assertStartingLineupAllowedInTx,
  confirmMatchRosterInTx,
  lockMatchInTx,
  persistMatchRosterInTx,
} from "@/lib/match-rosters/service";
import { validateRosterSelection } from "@/lib/matches/roster-rules";
import { getTeamIdForCaptain } from "./_shared";

function assertLineupShape(match: Match, starterIds: string[], substituteIds: string[]): void {
  // Cheap structural check for early UX feedback; eligibility is judged again
  // against DB facts inside the transaction.
  validateRosterSelection(starterIds, substituteIds, match.ownership !== "major_stage");
}

async function revalidateAfterRosterChange(match: Pick<Match, "seasonId" | "id">): Promise<void> {
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.id, match.seasonId),
  });
  if (season) revalidateMatchPaths(season.slug, match.id);
}

/**
 * 队长提交本场首发阵容；Major 仅记录恰好 5 名首发。
 * 仅允许比赛尚未开始（scheduled）时提交；名单通过管理员确认后才能用于开赛。
 */
export async function submitMatchRoster(
  matchId: string,
  input: { starterIds: string[]; substituteIds?: string[] },
): Promise<ActionResult<{ rosterId: string }>> {
  const { starterIds, substituteIds = [] } = input;
  try {
    const session = await requireAuth();
    const match = await getMatchOrThrow(matchId);

    if (match.status !== "scheduled") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛当前状态不允许提交名单");
    }

    const teamId = await getTeamIdForCaptain(session.userId, match);
    if (!teamId) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以提交名单");
    }

    assertLineupShape(match, starterIds, substituteIds);

    const actorId = auditActorId(session);
    const rosterId = await db.transaction(async (tx) => {
      const locked = await lockMatchInTx(tx, matchId);
      if (locked.status !== "scheduled") {
        throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已开始或取消，不能再调整阵容");
      }
      await assertStartingLineupAllowedInTx(tx, {
        match: locked,
        teamId,
        starterIds,
        substituteIds,
      });
      const summary = await persistMatchRosterInTx(tx, {
        match: locked,
        teamId,
        submittedBy: session.userId,
        source: "participant",
        starterIds,
        substituteIds,
      });

      await tx.insert(auditLogs).values({
        seasonId: locked.seasonId,
        action: "match.roster.submit",
        actorId,
        targetId: summary.rosterId,
        targetType: "match_roster",
        meta: { matchId, teamId, source: "participant", starterIds, substituteIds },
      });

      return summary.rosterId;
    });

    await revalidateAfterRosterChange(match);

    return ok({ rosterId });
  } catch (e) {
    return actionError("submitMatchRoster", e);
  }
}

/**
 * 管理员代表队伍选择本场首发（含“使用默认首发”）。
 * 服务端只接收显式给出的五名选手，绝不隐式推断；仍需另行确认后才能开赛。
 */
export async function adminSelectMatchRoster(
  matchId: string,
  teamId: string,
  input: { starterIds: string[]; substituteIds?: string[]; note?: string },
): Promise<ActionResult<{ rosterId: string }>> {
  const { starterIds, substituteIds = [], note } = input;
  try {
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    if (match.status !== "scheduled") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛当前状态不允许选择名单");
    }

    assertLineupShape(match, starterIds, substituteIds);

    const actorId = auditActorId(admin);
    const rosterId = await db.transaction(async (tx) => {
      const locked = await lockMatchInTx(tx, matchId);
      if (locked.status !== "scheduled") {
        throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已开始或取消，不能再调整阵容");
      }
      if (teamId !== locked.teamAId && teamId !== locked.teamBId) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "所选队伍不属于本场比赛");
      }
      await assertStartingLineupAllowedInTx(tx, {
        match: locked,
        teamId,
        starterIds,
        substituteIds,
      });
      const summary = await persistMatchRosterInTx(tx, {
        match: locked,
        teamId,
        submittedBy: null,
        source: "admin_select",
        starterIds,
        substituteIds,
      });

      await tx.insert(auditLogs).values({
        seasonId: locked.seasonId,
        action: "match.roster.admin_select",
        actorId,
        targetId: summary.rosterId,
        targetType: "match_roster",
        meta: {
          matchId,
          teamId,
          source: "admin_select",
          starterIds,
          substituteIds,
          note: note ?? null,
        },
      });

      return summary.rosterId;
    });

    await revalidateAfterRosterChange(match);

    return ok({ rosterId });
  } catch (e) {
    return actionError("adminSelectMatchRoster", e);
  }
}

/**
 * 管理员确认一方名单。确认时重新按冻结名单/归属规则完整校验；
 * 通过后名单成为开赛前提事实，重复确认为幂等。
 */
export async function confirmMatchRoster(
  rosterId: string
): Promise<ActionResult<{ alreadyConfirmed: boolean; matchId: string; teamId: string }>> {
  try {
    const [existing] = await db
      .select({ matchId: matchRosters.matchId })
      .from(matchRosters)
      .where(eq(matchRosters.id, rosterId));
    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, ERROR_MESSAGES.NOT_FOUND);
    }
    const match = await getMatchOrThrow(existing.matchId);
    const admin = await requireSeasonAdmin(match.seasonId);

    const outcome = await db.transaction((tx) =>
      confirmMatchRosterInTx(tx, { rosterId, actorId: auditActorId(admin) }),
    );

    if (!outcome.alreadyConfirmed) {
      await revalidateAfterRosterChange({ seasonId: match.seasonId, id: match.id });
    }

    return ok({
      alreadyConfirmed: outcome.alreadyConfirmed,
      matchId: outcome.matchId,
      teamId: outcome.teamId,
    });
  } catch (e) {
    return actionError("confirmMatchRoster", e);
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
    const actorId = auditActorId(admin);

    await db.transaction(async (tx) => {
      const locked = await lockMatchInTx(tx, roster.matchId);
      if (locked.status !== "scheduled") {
        throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已开始或取消，名单已定格");
      }
      await tx
        .update(matchRosters)
        .set({ status: "unlocked", confirmedAt: null, confirmedBy: null, updatedAt: new Date() })
        .where(eq(matchRosters.id, rosterId));

      await tx.insert(auditLogs).values({
        seasonId: locked.seasonId,
        action: "match.roster.unlock",
        actorId,
        targetId: rosterId,
        targetType: "match_roster",
        meta: { matchId: roster.matchId, teamId: roster.teamId },
      });
    });

    await revalidateAfterRosterChange(match);

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
