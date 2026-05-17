"use server";

import { eq, asc, and, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, matchMaps, matchVetoSteps, matchRosters, matchRosterPlayers, teams, teamMembers, auditLogs } from "@/db/schema";
import { ok } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { advanceMatch as bracketAdvance, type BracketStageRef, type ResolvedBracketMatch } from "@/lib/bracket";
import type { Database } from "brackets-manager";
import {
  type MatchStatus,
  assertMatchTransition,
  resolveMatchFormat,
} from "@/lib/match-transitions";
import { getMaxMaps, getWinThreshold } from "@/types/match";
import { actionError, getSeasonOrThrow, getMatchOrThrow } from "@/lib/action-utils";
import { revalidateMatchPaths, revalidateSeasonPaths } from "@/lib/revalidation";
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

      // 开赛时自动为两队填充默认名单（若尚未提交）
      if (nextStatus === "in_progress") {
        const existingRosters = await tx.query.matchRosters.findMany({
          where: and(
            eq(matchRosters.matchId, matchId),
            inArray(matchRosters.teamId, [match.teamAId, match.teamBId]),
          ),
        });
        const existingTeamIds = new Set(existingRosters.map((r) => r.teamId));

        for (const teamId of [match.teamAId, match.teamBId]) {
          if (existingTeamIds.has(teamId)) continue;
          const starterIds = await tx
            .select({ id: teamMembers.id })
            .from(teamMembers)
            .where(eq(teamMembers.teamId, teamId))
            .orderBy(asc(teamMembers.joinedAt))
            .limit(5);
          if (starterIds.length > 0) {
            const [roster] = await tx
              .insert(matchRosters)
              .values({ matchId, teamId, submittedBy: session.userId })
              .returning({ id: matchRosters.id });
            await tx.insert(matchRosterPlayers).values(
              starterIds.map((s) => ({
                rosterId: roster.id,
                teamMemberId: s.id,
                isStarter: true,
              })),
            );
          }
        }
      }

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

// ── 录入单图结果（BO1/BO3/BO5） ───────────────────────────────────────────────

/**
 * 录入一张地图的比赛结果。
 * 系统根据已完成地图自动计算大比分，达到 maxWins 时自动结束系列赛并推进 bracket。
 * 支持 BO1/BO3/BO5；BO1 也可继续走 recordMatchResult 直接录入总分。
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

    const isStatusAllowed = match.format === "bo1"
      ? match.status === "in_progress" || match.status === "scheduled"
      : match.status === "in_progress";
    if (!isStatusAllowed) {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛状态不允许录入地图结果");
    }

    const season = await getSeasonOrThrow(match.seasonId);
    const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
    if (!mapPool.includes(mapName)) {
      throw new AppError(ErrorCode.MATCH_MAP_INVALID, "地图不在当前赛季图池中");
    }

    const maxWins = getWinThreshold(match.format);
    const maxMaps = getMaxMaps(match.format);

    if (mapOrder < 1 || mapOrder > maxMaps) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `${match.format.toUpperCase()} 图序号须在 1-${maxMaps} 之间`);
    }

    // 所有写操作及其依赖的读操作放入同一事务，防止 TOCTOU
    let seriesFinished = false;

    await db.transaction(async (tx) => {
      // BO1 从 scheduled 自动转换为 in_progress
      if (match.format === "bo1" && match.status === "scheduled") {
        await tx
          .update(matches)
          .set({ status: "in_progress", updatedAt: new Date() })
          .where(eq(matches.id, matchId));
      }

      // 事务内读快照，防止并发插入同名地图
      const existingMaps = await tx.query.matchMaps.findMany({
        where: eq(matchMaps.matchId, matchId),
      });
      if (existingMaps.some((m) => m.mapName === mapName)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `地图 ${mapName} 在本场比赛中已存在`);
      }

      // 统计加入本图后的地图胜场
      const allMaps = [...existingMaps, { scoreA, scoreB }];
      let mapWinsA = 0;
      let mapWinsB = 0;
      for (const m of allMaps) {
        if (m.scoreA === null || m.scoreB === null) continue;
        if (m.scoreA > m.scoreB) mapWinsA++;
        else mapWinsB++;
      }

      seriesFinished = mapWinsA >= maxWins || mapWinsB >= maxWins;

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

        if (season.bracketData && match.bracketNodeId) {
          const { updatedData, newResolvedMatches } = await bracketAdvance(
            match.bracketNodeId,
            mapWinsA,
            mapWinsB,
            season.bracketData as Database
          );
          await tx.update(seasons).set({ bracketData: updatedData as Database, updatedAt: new Date() }).where(eq(seasons.id, match.seasonId));
          await insertResolvedBracketMatches(
            tx, match.seasonId, match.stage,
            updatedData as Database, newResolvedMatches,
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
      await tx
        .update(matches)
        .set({ completionDeadline: input.completionDeadline, updatedAt: new Date() })
        .where(inArray(matches.id, matchIds));

      await tx.insert(auditLogs).values({
        seasonId: input.seasonId,
        action: "match.batch_set_completion_deadline",
        actorId: admin.email,
        targetId: input.seasonId,
        targetType: "season",
        meta: {
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

    const season = await getSeasonOrThrow(match.seasonId);

    await db.transaction(async (tx) => {
      // 级联删除相关数据
      await tx.delete(matchVetoSteps).where(eq(matchVetoSteps.matchId, matchId));
      await tx.delete(matchMaps).where(eq(matchMaps.matchId, matchId));

      // matchRosterPlayers 需先查询 rosterIds
      const rosterIds = await tx
        .select({ id: matchRosters.id })
        .from(matchRosters)
        .where(eq(matchRosters.matchId, matchId));
      if (rosterIds.length > 0) {
        await tx.delete(matchRosterPlayers).where(
          inArray(
            matchRosterPlayers.rosterId,
            rosterIds.map((r) => r.id),
          ),
        );
      }
      await tx.delete(matchRosters).where(eq(matchRosters.matchId, matchId));

      // 最后删除比赛本身
      await tx.delete(matches).where(eq(matches.id, matchId));

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.delete",
        actorId: auditActorId(session),
        targetId: matchId,
        targetType: "match",
        meta: { stage: match.stage, format: match.format, teamAId: match.teamAId, teamBId: match.teamBId },
      });
    });

    revalidateMatchPaths(season.slug, matchId);
    return ok(undefined);
  } catch (e) {
    return actionError("deleteMatch", e);
  }
}
