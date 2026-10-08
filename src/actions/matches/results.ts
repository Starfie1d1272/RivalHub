"use server";

import { correctMapScoreInTx, mapCorrectionReviewSchema } from "@/lib/matches/map-score-correction";
import { writeAuditInTx } from "@/lib/audit/write";

import { revalidatePath } from "next/cache";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, matchMaps, matchTimeProposals } from "@/db/schema";
import { ok } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { advanceStageBracket, ensureResolvedBracketMatch, loadStageBracketState, saveStageBracketState, type ResolvedBracketMatch } from "@/lib/bracket";
import {
  assertMatchTransition,
  resolveMatchFormat,
} from "@/lib/match-transitions";
import { getMaxMaps, isMatchStatus } from "@/types/match";
import { actionError, getSeasonOrThrow, getMatchOrThrow } from "@/lib/action-utils";
import {
  applyMatchStatusTransitionInTx,
  lockMatchInTx,
} from "@/lib/match-rosters/service";
import { maybeFinishSeason } from "@/lib/seasons/transitions";
import { revalidateMatchPaths, revalidateSeasonPaths, updatePublicSeasonTags } from "@/lib/revalidation";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/lib/seasons/compatibility";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import {
  validateMapScore,
} from "@/lib/matches/result-rules";
import { recordManualMapResultInTx } from "@/lib/matches/manual-result";
import { traceOperation } from "@/lib/observability/server";
import { completeCompetitionQualificationIfReadyInTx } from "@/lib/competition-qualification/runtime";
import { assertGenericMatchCanBeDeleted, deleteScheduledMatchAndDependentsInTx } from "@/lib/matches/deletion";

/** Persist provider-resolved nodes through the fail-closed bracket boundary. */
async function insertResolvedBracketMatches(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  seasonId: string,
  stageKey: string,
  resolvedMatches: ResolvedBracketMatch[],
  stagePlan: ReturnType<typeof normalizeStagePlan>,
) {
  for (const resolved of resolvedMatches) {
    await ensureResolvedBracketMatch(tx, {
      seasonId,
      stageKey,
      resolved,
      format: resolveMatchFormat(stagePlan, stageKey, resolved.roundNumber, resolved.groupNumber),
    });
  }
}

// ── 更新比赛状态 ──────────────────────────────────────────────────────────

/**
 * 通用操作只处理管理员取消。在线比赛必须在 Veto Room 完成双方确认后，
 * 由共享 roster status transition 与 session start 同事务开始。
 */
export async function updateMatchStatus(
  matchId: string,
  nextStatus: "in_progress" | "cancelled"
): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);
    if (nextStatus === "in_progress") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛须由双方在 Veto Room 确认后开始。");
    }
    if (!isMatchStatus(match.status)) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, `无效的比赛状态: ${match.status}`);
    }
    assertMatchTransition(match.status, nextStatus);

    const seasonForStatus = await getSeasonOrThrow(match.seasonId);
    let finishedSlug: string | null = null;
    await traceOperation("match.status.transition", {
      scope: "match",
      operation: "status.transition",
      attributes: { "rivalhub.workflow": "match_runtime" },
    }, () => db.transaction(async (tx) => {
      await applyMatchStatusTransitionInTx(tx, {
        matchId,
        nextStatus,
        actorId: auditActorId(session),
      });

      if (nextStatus === "cancelled" && !match.testConfig) {
        finishedSlug = await maybeFinishSeason(tx, match.seasonId);
      }
    }));

    revalidateMatchPaths(seasonForStatus.slug, matchId);
    if (finishedSlug) {
      updatePublicSeasonTags(finishedSlug, match.seasonId);
      revalidatePath(`/${finishedSlug}`);
    }

    return ok(undefined);
  } catch (e) {
    return actionError("updateMatchStatus", e);
  }
}

// ── 录入单图结果（BO1/BO3/BO5） ───────────────────────────────────────────────

/**
 * 录入一张地图的比赛结果。
 * 系统根据已完成地图自动计算大比分，达到 maxWins 时自动结束系列赛并推进 bracket。
 * 支持 BO1/BO3/BO5；matches 只保存由实际地图胜负推导出的系列赛比分。
 */
export async function recordMapResult(
  matchId: string,
  mapOrder: number,
  mapName: string,
  scoreA: number,
  scoreB: number,
  pickedByEntryId: string | null,
  teamAStartSide: "t" | "ct" | null
): Promise<ActionResult<{ seriesFinished: boolean }>> {
  try {
    validateMapScore(scoreA, scoreB);

    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.status !== "in_progress" && !(match.testConfig && match.status === "finished" && ["pending", "recorded"].includes(match.resultDisposition ?? ""))) {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛状态不允许录入地图结果");
    }

    const season = await getSeasonOrThrow(match.seasonId);
    const mapPool = match.testConfig?.mapPool ?? normalizeRegistrationConfig(season.registrationConfig).mapPool;
    if (!mapPool.includes(mapName)) {
      throw new AppError(ErrorCode.MATCH_MAP_INVALID, "地图不在当前赛季图池中");
    }

    const maxMaps = getMaxMaps(match.format);

    if (mapOrder < 1 || mapOrder > maxMaps) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `${match.format.toUpperCase()} 图序号须在 1-${maxMaps} 之间`);
    }

    // 所有写操作及其依赖的读操作放入同一事务，防止 TOCTOU
    let seriesFinished = false;
    let finishedSlug: string | null = null;

    await traceOperation("match.result.record", {
      scope: "match",
      operation: "result.record",
      attributes: { "rivalhub.workflow": "match_runtime" },
    }, () => db.transaction(async (tx) => {
      const result = await recordManualMapResultInTx(tx, { matchId, mapOrder, mapName, scoreA, scoreB, pickedByEntryId, teamAStartSide, actorId: auditActorId(session) });
      seriesFinished = result.seriesFinished;
      finishedSlug = result.finishedSlug;
    }));

    revalidateMatchPaths(season.slug, matchId);
    if (finishedSlug) {
      updatePublicSeasonTags(finishedSlug, match.seasonId);
      revalidatePath(`/${finishedSlug}`);
    }

    return ok({ seriesFinished });
  } catch (e) {
    return actionError("recordMapResult", e);
  }
}

// ── 更新比赛时间 ──────────────────────────────────────────────────────────

/**
 * 设置或清除比赛的预定时间（scheduledAt）。
 * 已完成或已取消的比赛不允许修改。
 */
export async function updateMatchScheduledAt(
  matchId: string,
  scheduledAt: Date | null
): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.status === "finished" || match.status === "cancelled") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "已结束或已取消的比赛不能修改时间");
    }

    const seasonForSch = await getSeasonOrThrow(match.seasonId);
    await db.transaction(async (tx) => {
      await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
      const now = new Date();
      await tx
        .update(matches)
        .set({ scheduledAt, updatedAt: now })
        .where(eq(matches.id, matchId));

      // 比赛时间被管理员直接设定后，同场所有 pending 提议失效，避免幽灵提议卡在 pending。
      if (scheduledAt) {
        await tx
          .update(matchTimeProposals)
          .set({ status: "expired", updatedAt: now })
          .where(
            and(
              eq(matchTimeProposals.matchId, matchId),
              eq(matchTimeProposals.status, "pending"),
            ),
          );
      }

      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "match.update_scheduled_at",
        actorId: session.email,
        targetId: matchId,meta: { scheduledAt: scheduledAt?.toISOString() ?? null },
      });
    });

    revalidateMatchPaths(seasonForSch.slug, matchId);

    return ok(undefined);
  } catch (e) {
    return actionError("updateMatchScheduledAt", e);
  }
}

// ── 更新比赛最晚完成时间 ──────────────────────────────────────────────────

/**
 * 设置或清除比赛的最晚完成时间。
 * 队长时间协商的确认截止时间 = completionDeadline - 缓冲（排位赛 24h，正赛 0h）。
 */
export async function updateMatchCompletionDeadline(
  matchId: string,
  completionDeadline: Date | null
): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.status === "finished" || match.status === "cancelled") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "已结束或已取消的比赛不能修改最晚完成时间");
    }
    if (completionDeadline && completionDeadline.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "最晚完成时间必须晚于当前时间");
    }
    if (
      completionDeadline &&
      match.scheduledAt &&
      match.scheduledAt.getTime() > completionDeadline.getTime()
    ) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "最晚完成时间不能早于已设定的比赛时间");
    }

    const season = await getSeasonOrThrow(match.seasonId);
    await db.transaction(async (tx) => {
      await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
      await tx
        .update(matches)
        .set({ completionDeadline, updatedAt: new Date() })
        .where(eq(matches.id, matchId));

      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "match.update_completion_deadline",
        actorId: session.email,
        targetId: matchId,meta: { completionDeadline: completionDeadline?.toISOString() ?? null },
      });
    });

    revalidateMatchPaths(season.slug, matchId);

    return ok(undefined);
  } catch (e) {
    return actionError("updateMatchCompletionDeadline", e);
  }
}

/**
 * 批量设置截止时间：按 stage + round（或 entryRound）维度。
 * 将 completionDeadline 写入该维度下所有 scheduled/in_progress 状态的比赛。
 */
export async function batchSetCompletionDeadline(input: {
  seasonId: string;
  stage: string;
  round?: number | null;
  entryRound?: string | null;
  completionDeadline: Date;
}): Promise<ActionResult<{ updated: number }>> {
  try {
    const admin = await requireSeasonAdmin(input.seasonId);

    if (input.completionDeadline.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "截止时间必须晚于当前时间");
    }

    const season = await getSeasonOrThrow(input.seasonId);

    const conditions = [
      eq(matches.seasonId, input.seasonId),
      eq(matches.stage, input.stage),
      inArray(matches.status, ["scheduled", "in_progress"]),
    ];

    if (input.round != null) {
      conditions.push(eq(matches.round, input.round));
    }
    if (input.entryRound != null) {
      conditions.push(eq(matches.entryRound, input.entryRound));
    }

    const targetMatches = await db.query.matches.findMany({
      where: and(...conditions),
      columns: { id: true },
    });

    if (targetMatches.length === 0) {
      return ok({ updated: 0 });
    }

    const matchIds = targetMatches.map((m) => m.id);

    await db.transaction(async (tx) => {
      await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
      await tx
        .update(matches)
        .set({ completionDeadline: input.completionDeadline, updatedAt: new Date() })
        .where(inArray(matches.id, matchIds));

      await writeAuditInTx(tx, {
        seasonId: input.seasonId,
        action: "match.batch_set_completion_deadline",
        actorId: admin.email,
        targetId: input.seasonId,meta: {
          stage: input.stage,
          round: input.round ?? null,
          entryRound: input.entryRound ?? null,
          completionDeadline: input.completionDeadline.toISOString(),
          matchCount: matchIds.length,
        },
      });
    });

    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);

    return ok({ updated: matchIds.length });
  } catch (e) {
    return actionError("batchSetCompletionDeadline", e);
  }
}

// ── 删除比赛 ──────────────────────────────────────────────────────────────

/**
 * 删除一场「已排期」状态的比赛，级联删除相关地图记录、BP 数据及人员名单。
 * 已开始的比赛、由 Bracket 自动生成的比赛不允许删除。
 */
export async function deleteMatch(matchId: string): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.bracketNodeId) {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "无法删除 Bracket 自动生成的比赛");
    }
    assertGenericMatchCanBeDeleted(match);

    const season = await getSeasonOrThrow(match.seasonId);

    await db.transaction(async (tx) => {
      await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
      await deleteScheduledMatchAndDependentsInTx(tx, matchId);

      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "match.delete",
        actorId: auditActorId(session),
        targetId: matchId,meta: { stage: match.stage, format: match.format, entryAId: match.entryAId, entryBId: match.entryBId },
      });
    });

    revalidateMatchPaths(season.slug, matchId);
    return ok(undefined);
  } catch (e) {
    return actionError("deleteMatch", e);
  }
}

// ── 修改完成时间 ──────────────────────────────────────────────────────────

/**
 * 更新已完成比赛的 completed_at 时间戳。
 * 仅允许 status === "finished" 的比赛修改。
 */
export async function updateMatchCompletedAt(
  matchId: string,
  completedAtStr: string | null,
): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.status !== "finished") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "只有已完成的比赛才能修改完成时间");
    }

    const { parseCSTInput } = await import("@/lib/utils/date");
    const completedAt = parseCSTInput(completedAtStr);

    const season = await getSeasonOrThrow(match.seasonId);

    await db.transaction(async (tx) => {
      await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
      await tx
        .update(matches)
        .set({ completedAt, updatedAt: new Date() })
        .where(eq(matches.id, matchId));

      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "update_match_completed_at",
        actorId: auditActorId(session),
        targetId: matchId,meta: { completedAt: completedAt?.toISOString() ?? null },
      });
    });

    revalidateMatchPaths(season.slug, matchId);
    return ok(undefined);
  } catch (e) {
    return actionError("updateMatchCompletedAt", e);
  }
}

// ── 修正单图比分 ──────────────────────────────────────────────────────────────

/** Correct a reviewed completed map through the shared official-result owner. */
export async function correctMapScore(mapId: string, scoreA: number, scoreB: number, reviewed: unknown): Promise<ActionResult<void>> {
  try {
    validateMapScore(scoreA, scoreB);
    const review = mapCorrectionReviewSchema.parse(reviewed);
    const map = await db.query.matchMaps.findFirst({ where: eq(matchMaps.id, mapId) });
    if (!map) throw new AppError(ErrorCode.NOT_FOUND, "地图记录不存在");
    const match = await getMatchOrThrow(map.matchId);
    const session = await requireSeasonAdmin(match.seasonId);
    const season = await getSeasonOrThrow(match.seasonId);
    await db.transaction(tx => correctMapScoreInTx(tx, { matchId: match.id, mapId, scoreA, scoreB, review, actorId: auditActorId(session) }));
    revalidateMatchPaths(season.slug, match.id);
    return ok(undefined);
  } catch (error) { return actionError("correctMapScore", error); }
}

// ── 弃赛判负 ─────────────────────────────────────────────────────────────────

const FORFEIT_WINNER_SCORE: Record<"bo1" | "bo3" | "bo5", number> = {
  bo1: 1,
  bo3: 2,
  bo5: 3,
};

/**
 * 记录弃赛结果：跳过 BP 要求，按格式写入标准弃赛比分并推进 bracket。
 * 可在 scheduled 或 in_progress 状态调用。
 */
export async function forfeitMatch(
  matchId: string,
  loserTeamId: string,
  reason: string,
): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new AppError(ErrorCode.VALIDATION_FAILED, "请记录弃赛/判负原因。");

    assertMatchTransition(match.status, "finished");

    if (loserTeamId !== match.entryAId && loserTeamId !== match.entryBId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "弃赛队伍不属于本场比赛");
    }

    const season = await getSeasonOrThrow(match.seasonId);
    let finishedSlug: string | null = null;

    await db.transaction(async (tx) => {
      const locked = await lockMatchInTx(tx, matchId);
      assertMatchTransition(locked.status, "finished");
      if (loserTeamId !== locked.entryAId && loserTeamId !== locked.entryBId) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "弃赛队伍不属于本场比赛");
      }
      const lockedWinnerScore = FORFEIT_WINNER_SCORE[locked.format];
      const lockedLoserIsA = loserTeamId === locked.entryAId;
      const lockedScoreA = lockedLoserIsA ? 0 : lockedWinnerScore;
      const lockedScoreB = lockedLoserIsA ? lockedWinnerScore : 0;
      await tx.delete(matchMaps).where(
        and(eq(matchMaps.matchId, matchId), isNull(matchMaps.scoreA), isNull(matchMaps.scoreB))
      );

      await tx
        .update(matches)
        .set({
          scoreA: lockedScoreA,
          scoreB: lockedScoreB,
          status: "finished",
          isForfeit: true,
          ...(locked.testConfig ? { resultDisposition: "recorded" as const } : {}),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(matches.id, matchId));

      if (locked.qualificationRunId) {
        await completeCompetitionQualificationIfReadyInTx(tx, locked.qualificationRunId);
      }

      const bracketState = locked.bracketNodeId
        ? await loadStageBracketState(tx, locked.seasonId, locked.stage)
        : null;
      if (bracketState && locked.bracketNodeId) {
        const { updatedData, newResolvedMatches } = await advanceStageBracket(
          locked.stage,
          locked.bracketNodeId,
          { scoreA: lockedScoreA, scoreB: lockedScoreB },
          bracketState,
        );
        await saveStageBracketState(tx, locked.seasonId, locked.stage, updatedData);
        await insertResolvedBracketMatches(
          tx, locked.seasonId, locked.stage, newResolvedMatches,
          normalizeStagePlan(season.stagePlan),
        );
      }

      finishedSlug = match.testConfig ? null : await maybeFinishSeason(tx, match.seasonId);

      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "match.forfeit",
        actorId: auditActorId(session),
        targetId: matchId,meta: { loserTeamId, scoreA: lockedScoreA, scoreB: lockedScoreB, format: locked.format, reason: normalizedReason },
      });
    });

    revalidateMatchPaths(season.slug, matchId);
    if (finishedSlug) {
      updatePublicSeasonTags(finishedSlug, match.seasonId);
      revalidatePath(`/${finishedSlug}`);
    }
    return ok(undefined);
  } catch (e) {
    return actionError("forfeitMatch", e);
  }
}
