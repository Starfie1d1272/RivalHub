"use server";

import { eq, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, matchMaps, teams, auditLogs } from "@/db/schema";
import { ok } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { advanceMatch as bracketAdvance, type BracketStageRef, type ResolvedBracketMatch } from "@/lib/bracket";
import type { Database } from "brackets-manager";
import {
  type MatchStatus,
  assertMatchTransition,
  resolveMatchFormat,
} from "@/lib/match-transitions";
import { getWinThreshold } from "@/types/match";
import { actionError, getSeasonOrThrow, getMatchOrThrow } from "@/lib/action-utils";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/types/season";

/**
 * 将 bracket 推进后解析出的新对阵批量写入 matches 表。
 * recordMatchResult 和 recordMapResult 共用。
 */
async function insertResolvedBracketMatches(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  seasonId: string,
  defaultStage: string,
  updatedData: Database,
  resolvedMatches: ResolvedBracketMatch[],
  stagePlan: ReturnType<typeof normalizeStagePlan>,
) {
  const seasonTeams = await tx.query.teams.findMany({
    where: eq(teams.seasonId, seasonId),
    orderBy: [asc(teams.draftOrder)],
  });
  const dbStages = updatedData.stage as BracketStageRef[];
  for (const bm of resolvedMatches) {
    const teamA = seasonTeams[bm.teamAParticipantId];
    const teamB = seasonTeams[bm.teamBParticipantId];
    if (!teamA || !teamB) continue;
    const bmStageName = dbStages.find((s) => s.id === bm.stageId)?.name;
    const stage = stagePlan.find((s) => s.name === bmStageName)?.key ?? defaultStage;
    await tx.insert(matches).values({
      seasonId,
      teamAId: teamA.id,
      teamBId: teamB.id,
      stage,
      format: resolveMatchFormat(stagePlan, stage, bm.roundNumber),
      status: "scheduled",
      bracketNodeId: bm.bracketMatchId.toString(),
    });
  }
}

// ── 更新比赛状态 ──────────────────────────────────────────────────────────

/**
 * 将比赛状态推进一步（scheduled→in_progress，scheduled/in_progress→cancelled）。
 */
export async function updateMatchStatus(
  matchId: string,
  nextStatus: "in_progress" | "cancelled"
): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);
    assertMatchTransition(match.status as MatchStatus, nextStatus);

    const seasonForStatus = await getSeasonOrThrow(match.seasonId);
    await db.transaction(async (tx) => {
      await tx
        .update(matches)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(matches.id, matchId));

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.status_update",
        actorId: session.email,
        targetId: matchId,
        targetType: "match",
        meta: { from: match.status, to: nextStatus },
      });
    });

    revalidateMatchPaths(seasonForStatus.slug, matchId);

    return ok(undefined);
  } catch (e) {
    return actionError("updateMatchStatus", e);
  }
}

// ── 录入比赛结果 ──────────────────────────────────────────────────────────

/**
 * 录入系列赛比分，将比赛标记为 finished，并推进 bracket。
 * 若 bracket 中因此产生新的已确定对阵，自动创建对应 DB match 记录。
 */
export async function recordMatchResult(
  matchId: string,
  scoreA: number,
  scoreB: number
): Promise<ActionResult<void>> {
  try {
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
      throw new AppError(ErrorCode.MATCH_INVALID_SCORE, "比分必须为非负整数");
    }
    if (scoreA === scoreB) {
      throw new AppError(ErrorCode.MATCH_INVALID_SCORE, "系列赛不能平局，必须分出胜负");
    }

    const match = await getMatchOrThrow(matchId);

    // BO3/BO5 校验系列赛胜场数：胜者恰好达到 maxWins，败者不得超过 maxWins-1
    const maxWins = match.format === "bo1" ? null : getWinThreshold(match.format);
    if (maxWins !== null) {
      const winner = Math.max(scoreA, scoreB);
      const loser = Math.min(scoreA, scoreB);
      if (winner !== maxWins || loser >= maxWins) {
        throw new AppError(
          ErrorCode.MATCH_INVALID_SCORE,
          `${match.format.toUpperCase()} 系列赛比分不合法（胜者须恰好赢 ${maxWins} 图）`
        );
      }
    }
    const session = await requireSeasonAdmin(match.seasonId);
    assertMatchTransition(match.status as MatchStatus, "finished");

    const season = await getSeasonOrThrow(match.seasonId);

    // 事务保护：score 更新 + bracket 推进 + audit 原子化
    await db.transaction(async (tx) => {
      await tx
        .update(matches)
        .set({
          scoreA,
          scoreB,
          status: "finished",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(matches.id, matchId));

      // 推进 bracket（若 bracket 已初始化）
      if (season.bracketData && match.bracketNodeId) {
        const { updatedData, newResolvedMatches } = await bracketAdvance(
          match.bracketNodeId,
          scoreA,
          scoreB,
          season.bracketData as Database
        );

        await tx
          .update(seasons)
          .set({ bracketData: updatedData as Database, updatedAt: new Date() })
          .where(eq(seasons.id, match.seasonId));

        await insertResolvedBracketMatches(
          tx, match.seasonId, match.stage,
          updatedData as Database, newResolvedMatches,
          normalizeStagePlan(season.stagePlan),
        );
      }

    await tx.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.record_result",
      actorId: session.email,
      targetId: matchId,
      targetType: "match",
      meta: { scoreA, scoreB },
    });
    }); // end db.transaction

    revalidateMatchPaths(season.slug, matchId);

    return ok(undefined);
  } catch (e) {
    return actionError("recordMatchResult", e);
  }
}

// ── 录入单图结果（BO3/BO5） ───────────────────────────────────────────────

/**
 * 录入一张地图的比赛结果。
 * 系统根据已完成地图自动计算大比分，达到 maxWins 时自动结束系列赛并推进 bracket。
 * 仅用于 BO3/BO5；BO1 继续走 recordMatchResult。
 */
export async function recordMapResult(
  matchId: string,
  mapOrder: number,
  mapName: string,
  scoreA: number,
  scoreB: number,
  pickedByTeamId: string | null,
  teamAStartSide: "t" | "ct" | null
): Promise<ActionResult<{ seriesFinished: boolean }>> {
  try {
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
      throw new AppError(ErrorCode.MATCH_INVALID_SCORE, "比分必须为非负整数");
    }
    if (scoreA === scoreB) {
      throw new AppError(ErrorCode.MATCH_INVALID_SCORE, "单图不能平局");
    }

    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.format === "bo1") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "BO1 请使用直接录入比分功能");
    }
    if (match.status !== "in_progress") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛未在进行中");
    }

    const season = await getSeasonOrThrow(match.seasonId);
    const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
    if (!mapPool.includes(mapName)) {
      throw new AppError(ErrorCode.MATCH_MAP_INVALID, "地图不在当前赛季图池中");
    }

    const maxWins = getWinThreshold(match.format);
    const maxMaps = match.format === "bo5" ? 5 : 3;

    if (mapOrder < 1 || mapOrder > maxMaps) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `${match.format.toUpperCase()} 图序号须在 1-${maxMaps} 之间`);
    }

    // 检查同图名是否已存在（应用层约束）
    const existingMaps = await db.query.matchMaps.findMany({
      where: eq(matchMaps.matchId, matchId),
    });
    if (existingMaps.some((m) => m.mapName === mapName)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `地图 ${mapName} 在本场比赛中已存在`);
    }

    // 统计加入本图后的地图胜场（纯计算，不写 DB）
    const allMaps = [...existingMaps, { scoreA, scoreB }];
    let mapWinsA = 0;
    let mapWinsB = 0;
    for (const m of allMaps) {
      if (m.scoreA === null || m.scoreB === null) continue;
      if (m.scoreA > m.scoreB) mapWinsA++;
      else mapWinsB++;
    }

    const seriesFinished = mapWinsA >= maxWins || mapWinsB >= maxWins;

    // 如果系列赛结束且有 bracket，提前计算 bracket 推进结果（纯计算，不写 DB）
    let updatedBracketData: Database | null = null;
    let resolvedMatches: ResolvedBracketMatch[] = [];

    if (seriesFinished && season.bracketData && match.bracketNodeId) {
      const { updatedData, newResolvedMatches } = await bracketAdvance(
        match.bracketNodeId,
        mapWinsA,
        mapWinsB,
        season.bracketData as Database
      );
      updatedBracketData = updatedData as Database;
      resolvedMatches = newResolvedMatches;
    }

    // 所有写操作放入同一事务，确保原子性
    await db.transaction(async (tx) => {
      await tx.insert(matchMaps).values({
        matchId,
        mapOrder,
        mapName,
        pickedByTeamId,
        teamAStartSide,
        scoreA,
        scoreB,
        completedAt: new Date(),
      });

      if (seriesFinished) {
        await tx.update(matches).set({
          scoreA: mapWinsA,
          scoreB: mapWinsB,
          status: "finished",
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(matches.id, matchId));

        if (updatedBracketData) {
          await tx.update(seasons).set({ bracketData: updatedBracketData, updatedAt: new Date() }).where(eq(seasons.id, match.seasonId));
          await insertResolvedBracketMatches(
            tx, match.seasonId, match.stage,
            updatedBracketData, resolvedMatches,
            normalizeStagePlan(season.stagePlan),
          );
        }
      }

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.record_map_result",
        actorId: session.email,
        targetId: matchId,
        targetType: "match",
        meta: { mapOrder, mapName, scoreA, scoreB, seriesFinished },
      });
    });

    revalidateMatchPaths(season.slug, matchId);

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
      await tx
        .update(matches)
        .set({ scheduledAt, updatedAt: new Date() })
        .where(eq(matches.id, matchId));

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.update_scheduled_at",
        actorId: session.email,
        targetId: matchId,
        targetType: "match",
        meta: { scheduledAt: scheduledAt?.toISOString() ?? null },
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
 * 队长时间协商的确认截止时间 = completionDeadline - 24h。
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
      await tx
        .update(matches)
        .set({ completionDeadline, updatedAt: new Date() })
        .where(eq(matches.id, matchId));

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.update_completion_deadline",
        actorId: session.email,
        targetId: matchId,
        targetType: "match",
        meta: { completionDeadline: completionDeadline?.toISOString() ?? null },
      });
    });

    revalidateMatchPaths(season.slug, matchId);

    return ok(undefined);
  } catch (e) {
    return actionError("updateMatchCompletionDeadline", e);
  }
}
