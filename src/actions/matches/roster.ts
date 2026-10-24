"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  matchRosters,
  seasons,
} from "@/db/schema";
import { ok, fail, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireAuth, requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { getMatchOrThrow, actionError } from "@/lib/action-utils";
import { captureException } from "@/lib/observability/server";
import { revalidateMatchPaths } from "@/lib/revalidation";
import {
  confirmMatchRosterInTx,
  lockMatchInTx,
  persistMatchRosterInTx,
} from "@/lib/match-rosters/service";
import { loadMatchRosters } from "@/lib/match-rosters/read-model";
import { getEntryIdForRepresentative } from "./_shared";

async function revalidateAfterRosterChange(match: { seasonId: string; id: string }): Promise<boolean> {
  try {
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, match.seasonId), columns: { slug: true } });
    if (!season) throw new Error("Roster refresh season is unavailable");
    revalidateMatchPaths(season.slug, match.id);
    return false;
  } catch (error) {
    captureException("action.roster_refresh_failure", error, { scope: "action", operation: "roster.refresh" });
    return true;
  }
}
/**
 * 队长提交本场首发阵容；具体人数由事务内的 canonical policy 判定。
 * 仅允许比赛尚未开始（scheduled）时提交；有效名单在开赛事务中重新校验并冻结，无需管理员逐场确认。
 */
export async function submitMatchRoster(
  matchId: string,
  input: { starterIds: string[]; substituteIds?: string[]; vetoRepresentativeEventRosterMemberId: string },
): Promise<ActionResult<{ rosterId: string; refreshPending: boolean }>> {
  const { starterIds, substituteIds = [], vetoRepresentativeEventRosterMemberId } = input;
  try {
    const session = await requireAuth();
    const match = await getMatchOrThrow(matchId);

    if (match.status !== "scheduled") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛当前状态不允许提交名单");
    }

    const entryId = await getEntryIdForRepresentative(session.userId, match);
    if (!entryId) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以提交名单");
    }

    const actorId = auditActorId(session);
    const rosterId = await db.transaction(async (tx) => {
      const locked = await lockMatchInTx(tx, matchId);
      if (locked.status !== "scheduled") {
        throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已开始或取消，不能再调整阵容");
      }
      const summary = await persistMatchRosterInTx(tx, {
        match: locked,
        entryId,
        submittedBy: session.userId,
        source: "participant",
        starterIds,
        substituteIds,
        vetoRepresentativeEventRosterMemberId,
      });

      await writeAuditInTx(tx, {
        seasonId: locked.seasonId,
        action: "match.roster.submit",
        actorId,
        targetId: summary.rosterId,meta: { matchId, entryId, source: "participant", starterIds, substituteIds, vetoRepresentativeEventRosterMemberId },
      });

      return summary.rosterId;
    });

    const refreshPending = await revalidateAfterRosterChange(match);

    return ok({ rosterId, refreshPending });
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
  entryId: string,
  input: { starterIds: string[]; substituteIds?: string[]; note?: string; vetoRepresentativeEventRosterMemberId?: string | null },
): Promise<ActionResult<{ rosterId: string; refreshPending: boolean }>> {
  const { starterIds, substituteIds = [], note, vetoRepresentativeEventRosterMemberId = null } = input;
  try {
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    if (match.status !== "scheduled") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛当前状态不允许选择名单");
    }

    const actorId = auditActorId(admin);
    const rosterId = await db.transaction(async (tx) => {
      const locked = await lockMatchInTx(tx, matchId);
      if (locked.status !== "scheduled") {
        throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已开始或取消，不能再调整阵容");
      }
      if (entryId !== locked.entryAId && entryId !== locked.entryBId) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "所选队伍不属于本场比赛");
      }
      const summary = await persistMatchRosterInTx(tx, {
        match: locked,
        entryId,
        submittedBy: null,
        actorId,
        source: "admin_select",
        starterIds,
        substituteIds,
        vetoRepresentativeEventRosterMemberId,
      });

      await writeAuditInTx(tx, {
        seasonId: locked.seasonId,
        action: "match.roster.admin_select",
        actorId,
        targetId: summary.rosterId,meta: {
          matchId,
          entryId,
          source: "admin_select",
          starterIds,
          substituteIds,
          vetoRepresentativeEventRosterMemberId,
          note: note ?? null,
        },
      });

      return summary.rosterId;
    });

    const refreshPending = await revalidateAfterRosterChange(match);

    return ok({ rosterId, refreshPending });
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
): Promise<ActionResult<{ alreadyConfirmed: boolean; matchId: string; entryId: string; refreshPending: boolean }>> {
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
      confirmMatchRosterInTx(tx, { rosterId, actorId: auditActorId(admin), expectedMatchId: match.id, expectedSeasonId: match.seasonId }),
    );

    const refreshPending = await revalidateAfterRosterChange({ seasonId: match.seasonId, id: match.id });

    return ok({
      refreshPending,
      alreadyConfirmed: outcome.alreadyConfirmed,
      matchId: outcome.matchId,
      entryId: outcome.entryId,
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
): Promise<ActionResult<{ refreshPending: boolean }>> {
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
        .set({ status: "submitted", confirmedAt: null, confirmedBy: null, updatedAt: new Date() })
        .where(eq(matchRosters.id, rosterId));

      await writeAuditInTx(tx, {
        seasonId: locked.seasonId,
        action: "match.roster.unlock",
        actorId,
        targetId: rosterId,meta: { matchId: roster.matchId, entryId: roster.entryId },
      });
    });

    const refreshPending = await revalidateAfterRosterChange(match);

    return ok({ refreshPending });
  } catch (e) {
    return actionError("unlockMatchRoster", e);
  }
}

/** Retry cache work only, freshly authorized for either roster representative or season admin. */
export async function retryMatchRosterRefresh(matchId: string): Promise<ActionResult<void>> {
  try {
    const session = await requireAuth();
    const match = await getMatchOrThrow(matchId);
    if (!await getEntryIdForRepresentative(session.userId, match)) await requireSeasonAdmin(match.seasonId);
    if (await revalidateAfterRosterChange(match)) return fail({ code: ErrorCode.INTERNAL_ERROR, message: "名单已提交，刷新仍未完成，请稍后重试刷新。" });
    return ok(undefined);
  } catch (error) { return actionError("retryMatchRosterRefresh", error); }
}

/**
 * 查询某场比赛的名单（含首发/替补队员）。
 */
export async function getMatchRoster(matchId: string, entryId: string) {
  return (await loadMatchRosters(matchId, [entryId])).get(entryId) ?? null;
}
