"use server";

import { revalidatePath } from "next/cache";
import { eq, and, count, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, matchMaps, auditLogs } from "@/db/schema";
import { ok, fail } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { generateBracket, advanceMatch as bracketAdvance, seedPlayoff } from "@/lib/bracket";
import { calculateStandings } from "@/lib/standings";
import { getExecutor } from "@/lib/formats";
import {
  getFirstStage,
  getFirstStageOfType,
  getPreviousStage,
  normalizeStagePlan,
  type StageConfig,
} from "@/types/season";
import type { Database } from "brackets-manager";

// ── 状态机 ────────────────────────────────────────────────────────────────

type MatchStatus = "scheduled" | "in_progress" | "finished" | "cancelled";

const MATCH_TRANSITIONS: Partial<Record<`${MatchStatus}→${MatchStatus}`, true>> = {
  "scheduled→in_progress": true,
  "scheduled→cancelled": true,
  "in_progress→finished": true,
  "in_progress→cancelled": true,
};

function assertMatchTransition(current: MatchStatus, next: MatchStatus): void {
  const key = `${current}→${next}` as `${MatchStatus}→${MatchStatus}`;
  if (!MATCH_TRANSITIONS[key]) {
    throw new AppError(
      ErrorCode.MATCH_INVALID_TRANSITION,
      `比赛状态不允许从 ${current} 变更为 ${next}`
    );
  }
}

// ── 查询工具 ──────────────────────────────────────────────────────────────

async function getSeasonOrThrow(seasonId: string) {
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.id, seasonId),
  });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
  return season;
}

async function getMatchOrThrow(matchId: string) {
  const match = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
  });
  if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, ERROR_MESSAGES.MATCH_NOT_FOUND);
  return match;
}

function isEliminationStage(stage: StageConfig): boolean {
  return stage.type === "double_elim" || stage.type === "single_elim";
}

function matchFormatForStage(stage: StageConfig): "bo1" | "bo3" {
  return stage.type === "round_robin" || stage.type === "swiss" ? "bo1" : "bo3";
}

function getBracketStageId(data: Database, stageName: string): number | null {
  const dbStages = data.stage as Array<{ id: number; name: string }>;
  return dbStages.find((s) => s.name === stageName)?.id ?? null;
}

// ── 一键生成赛程 ──────────────────────────────────────────────────────────

/**
 * 根据赛季 capability 一键生成赛程。
 * 赛季必须处于 playing 状态，且当前无任何比赛记录（幂等保护）。
 */
export async function generateSchedule(
  seasonId: string
): Promise<ActionResult<{ matchCount: number }>> {
  try {
    const session = await requireSeasonAdmin(seasonId);
    const season = await getSeasonOrThrow(seasonId);

    if (season.status !== "playing") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有在赛季进行中才能生成赛程");
    }

    const [{ value: existingCount }] = await db
      .select({ value: count() })
      .from(matches)
      .where(eq(matches.seasonId, seasonId));

    if (existingCount > 0) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛程已生成，不可重复生成");
    }

    // 按 draft_order ASC 取队伍（决定 participantId 顺序）
    const seasonTeams = await db.query.teams.findMany({
      where: eq(teams.seasonId, seasonId),
      orderBy: [asc(teams.draftOrder)],
    });

    if (seasonTeams.length < 2) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍数量不足，无法生成赛程");
    }

    const stagePlan = normalizeStagePlan(season.stagePlan);
    const firstStage = getFirstStage(stagePlan);
    if (!firstStage) {
      throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "该赛季没有可生成的赛程阶段");
    }
    if (firstStage.type === "swiss") {
      throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "Swiss 执行器将在 v2 接入");
    }

    const playoffStage = firstStage.type === "round_robin"
      ? getFirstStageOfType(stagePlan, ["double_elim", "single_elim"])
      : isEliminationStage(firstStage)
        ? firstStage
        : null;

    const { data, resolvedMatches } = await generateBracket(seasonTeams, {
      qualifierFormat: firstStage.type === "round_robin" ? "round_robin" : null,
      playoffFormat: playoffStage
        ? (playoffStage.type === "double_elim" ? "double_elim" : "single_elim")
        : null,
      qualifierName: firstStage.type === "round_robin" ? firstStage.name : undefined,
      playoffName: playoffStage?.name,
    });

    const firstStageId = getBracketStageId(data as Database, firstStage.name);

    // 批量创建 match 记录
    let matchCount = 0;
    for (const bm of resolvedMatches) {
      if (firstStageId !== null && bm.stageId !== firstStageId) continue;
      const teamA = seasonTeams[bm.teamAParticipantId];
      const teamB = seasonTeams[bm.teamBParticipantId];
      if (!teamA || !teamB) continue;

      await db.insert(matches).values({
        seasonId,
        teamAId: teamA.id,
        teamBId: teamB.id,
        stage: firstStage.key,
        format: matchFormatForStage(firstStage),
        status: "scheduled",
        bracketNodeId: bm.bracketMatchId.toString(),
      });
      matchCount++;
    }

    // 持久化 bracket JSON
    await db
      .update(seasons)
      .set({ bracketData: data as Database, updatedAt: new Date() })
      .where(eq(seasons.id, seasonId));

    // Audit
    await db.insert(auditLogs).values({
      seasonId,
      action: "match.generate_schedule",
      actorId: session.email,
      targetId: seasonId,
      targetType: "season",
      meta: { matchCount, stageKey: firstStage.key },
    });

    revalidatePath(`/admin/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches`);

    return ok({ matchCount });
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    console.error("[generateSchedule]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

// ── 创建单场比赛 ──────────────────────────────────────────────────────────

/**
 * 手动创建一场比赛（无 bracket 节点关联）。
 */
export async function createMatch(
  seasonId: string,
  teamAId: string,
  teamBId: string,
  stage: string,
  format: "bo1" | "bo3" | "bo5"
): Promise<ActionResult<{ matchId: string }>> {
  try {
    const session = await requireSeasonAdmin(seasonId);

    if (teamAId === teamBId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "双方队伍不能相同");
    }
    const season = await getSeasonOrThrow(seasonId);
    const stageConfig = normalizeStagePlan(season.stagePlan).find((s) => s.key === stage);
    if (!stageConfig) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "未知赛程阶段");
    }
    if ((stageConfig.type === "round_robin" || stageConfig.type === "swiss") && format !== "bo1") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `${stageConfig.name} 只能是 BO1`);
    }

    // 校验两支队伍属于本赛季
    const teamRows = await db.query.teams.findMany({
      where: and(
        eq(teams.seasonId, seasonId),
      ),
    });
    const teamIds = new Set(teamRows.map((t) => t.id));
    if (!teamIds.has(teamAId) || !teamIds.has(teamBId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍不属于该赛季");
    }

    const [newMatch] = await db
      .insert(matches)
      .values({ seasonId, teamAId, teamBId, stage, format, status: "scheduled" })
      .returning({ id: matches.id });

    await db.insert(auditLogs).values({
      seasonId,
      action: "match.create",
      actorId: session.email,
      targetId: newMatch.id,
      targetType: "match",
      meta: { teamAId, teamBId, stage, format },
    });

    revalidatePath(`/admin/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches`);

    return ok({ matchId: newMatch.id });
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    console.error("[createMatch]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
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

    await db
      .update(matches)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(matches.id, matchId));

    const season = await getSeasonOrThrow(match.seasonId);
    await db.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.status_update",
      actorId: session.email,
      targetId: matchId,
      targetType: "match",
      meta: { from: match.status, to: nextStatus },
    });

    revalidatePath(`/admin/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches/${matchId}`);

    return ok(undefined);
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    console.error("[updateMatchStatus]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
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
    const maxWins = match.format === "bo3" ? 2 : match.format === "bo5" ? 3 : null;
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

    await db
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

      // 持久化更新后的 bracket JSON
      await db
        .update(seasons)
        .set({ bracketData: updatedData as Database, updatedAt: new Date() })
        .where(eq(seasons.id, match.seasonId));

      // 获取队伍列表（用于 participantId → teamId 映射）
      const seasonTeams = await db.query.teams.findMany({
        where: eq(teams.seasonId, match.seasonId),
        orderBy: [asc(teams.draftOrder)],
      });

      // 为新确定对阵创建 match 记录
      for (const bm of newResolvedMatches) {
        const teamA = seasonTeams[bm.teamAParticipantId];
        const teamB = seasonTeams[bm.teamBParticipantId];
        if (!teamA || !teamB) continue;

        const dbStages = updatedData.stage as Array<{ id: number; name: string }>;
        const bmStageName = dbStages.find((s) => s.id === bm.stageId)?.name;
        const stage = normalizeStagePlan(season.stagePlan).find((s) => s.name === bmStageName)?.key
          ?? match.stage;

        await db.insert(matches).values({
          seasonId: match.seasonId,
          teamAId: teamA.id,
          teamBId: teamB.id,
          stage,
          format: "bo3",
          status: "scheduled",
          bracketNodeId: bm.bracketMatchId.toString(),
        });
      }
    }

    await db.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.record_result",
      actorId: session.email,
      targetId: matchId,
      targetType: "match",
      meta: { scoreA, scoreB },
    });

    revalidatePath(`/admin/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches/${matchId}`);

    return ok(undefined);
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    console.error("[recordMatchResult]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
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

    const maxWins = match.format === "bo3" ? 2 : 3;
    const maxMaps = match.format === "bo3" ? 3 : 5;

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

    const season = await getSeasonOrThrow(match.seasonId);
    const seriesFinished = mapWinsA >= maxWins || mapWinsB >= maxWins;

    // 如果系列赛结束且有 bracket，提前计算 bracket 推进结果（纯计算，不写 DB）
    let updatedBracketData: Database | null = null;
    let resolvedMatches: Array<{
      teamAParticipantId: number;
      teamBParticipantId: number;
      bracketMatchId: number;
      stageId: number;
    }> = [];
    let seasonTeams: Awaited<ReturnType<typeof db.query.teams.findMany>> = [];

    if (seriesFinished && season.bracketData && match.bracketNodeId) {
      const { updatedData, newResolvedMatches } = await bracketAdvance(
        match.bracketNodeId,
        mapWinsA,
        mapWinsB,
        season.bracketData as Database
      );
      updatedBracketData = updatedData as Database;
      resolvedMatches = newResolvedMatches;
      seasonTeams = await db.query.teams.findMany({
        where: eq(teams.seasonId, match.seasonId),
        orderBy: [asc(teams.draftOrder)],
      });
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
          for (const bm of resolvedMatches) {
            const teamA = seasonTeams[bm.teamAParticipantId];
            const teamB = seasonTeams[bm.teamBParticipantId];
            if (!teamA || !teamB) continue;
            const dbStages = updatedBracketData.stage as Array<{ id: number; name: string }>;
            const bmStageName = dbStages.find((s) => s.id === bm.stageId)?.name;
            const stage = normalizeStagePlan(season.stagePlan).find((s) => s.name === bmStageName)?.key
              ?? match.stage;
            await tx.insert(matches).values({
              seasonId: match.seasonId,
              teamAId: teamA.id,
              teamBId: teamB.id,
              stage,
              format: "bo3",
              status: "scheduled",
              bracketNodeId: bm.bracketMatchId.toString(),
            });
          }
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

    revalidatePath(`/admin/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches/${matchId}`);

    return ok({ seriesFinished });
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    console.error("[recordMapResult]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
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

    await db
      .update(matches)
      .set({ scheduledAt, updatedAt: new Date() })
      .where(eq(matches.id, matchId));

    const season = await getSeasonOrThrow(match.seasonId);
    await db.insert(auditLogs).values({
      seasonId: match.seasonId,
      action: "match.update_scheduled_at",
      actorId: session.email,
      targetId: matchId,
      targetType: "match",
      meta: { scheduledAt: scheduledAt?.toISOString() ?? null },
    });

    revalidatePath(`/admin/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches/${matchId}`);

    return ok(undefined);
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    console.error("[updateMatchScheduledAt]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

// ── 初始化后续 Stage（基于上一阶段结果种子）───────────────────────────────

export async function initializeStage(
  seasonId: string,
  stageKey: string,
): Promise<ActionResult<{ matchCount: number }>> {
  try {
    const session = await requireSeasonAdmin(seasonId);
    const season = await getSeasonOrThrow(seasonId);

    if (season.status !== "playing") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有在赛季进行中才能初始化阶段");
    }
    if (!season.bracketData) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先一键生成赛程");
    }

    const stagePlan = normalizeStagePlan(season.stagePlan);
    const stage = stagePlan.find((s) => s.key === stageKey);
    if (!stage) {
      throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "该赛季没有这个赛程阶段");
    }
    if (!isEliminationStage(stage)) {
      throw new AppError(
        ErrorCode.SEASON_CAPABILITY_DISABLED,
        "v1 仅支持从上一阶段结果初始化淘汰赛阶段",
      );
    }

    const previousStage = getPreviousStage(stagePlan, stage.key);
    if (!previousStage) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "首个阶段请使用一键生成赛程");
    }

    const previousComplete = await getExecutor(previousStage.type).isComplete(seasonId, previousStage.key);
    if (!previousComplete) {
      throw new AppError(
        ErrorCode.SEASON_INVALID_STATUS,
        `${previousStage.name} 尚未全部结束，无法初始化 ${stage.name}`,
      );
    }

    const [{ value: existingStageMatches }] = await db
      .select({ value: count() })
      .from(matches)
      .where(and(eq(matches.seasonId, seasonId), eq(matches.stage, stage.key)));

    if (existingStageMatches > 0) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, `${stage.name} 已生成，不可重复生成`);
    }

    // 计算积分榜 → 得到种子顺序
    const seasonTeams = await db.query.teams.findMany({
      where: eq(teams.seasonId, seasonId),
      orderBy: [asc(teams.draftOrder)],
    });

    const standings = await calculateStandings(seasonId, seasonTeams, previousStage.key);
    // standings 已按种子排序（seed 1 在 index 0）
    const seededNames = standings.slice(0, stage.teamCount).map((s) => s.teamName);

    // 更新目标 bracket stage 种子
    const { updatedData, resolvedMatches } = await seedPlayoff(
      seededNames,
      season.bracketData as Database,
      stage.name,
    );

    // 持久化更新后的 bracket JSON
    await db
      .update(seasons)
      .set({ bracketData: updatedData as Database, updatedAt: new Date() })
      .where(eq(seasons.id, seasonId));

    // 创建第一轮正赛 match 记录
    // 注意：seedPlayoff 返回的 participantId 对应更新后 participant 表的 ID（按种子顺序）
    // 需要从 participant 名称反查 teamId
    const nameToTeam = new Map(seasonTeams.map((t) => [t.name, t]));
    const participants = updatedData.participant as Array<{ id: number; name: string }>;
    const participantIdToTeam = new Map(
      participants.map((p) => [p.id, nameToTeam.get(p.name)])
    );

    let matchCount = 0;
    const targetStageId = getBracketStageId(updatedData as Database, stage.name);

    for (const bm of resolvedMatches) {
      if (targetStageId === null || bm.stageId !== targetStageId) continue;
      const teamA = participantIdToTeam.get(bm.teamAParticipantId);
      const teamB = participantIdToTeam.get(bm.teamBParticipantId);
      if (!teamA || !teamB) continue;

      await db.insert(matches).values({
        seasonId,
        teamAId: teamA.id,
        teamBId: teamB.id,
        stage: stage.key,
        format: matchFormatForStage(stage),
        status: "scheduled",
        bracketNodeId: bm.bracketMatchId.toString(),
      });
      matchCount++;
    }

    await db.insert(auditLogs).values({
      seasonId,
      action: "match.initialize_stage",
      actorId: session.email,
      targetId: seasonId,
      targetType: "season",
      meta: { matchCount, stageKey: stage.key, seeds: seededNames },
    });

    revalidatePath(`/admin/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches`);

    return ok({ matchCount });
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    console.error("[initializeStage]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

/**
 * 向后兼容现有 UI：Rivals 的正赛 stage key 默认为 playoff。
 */
export async function generatePlayoff(
  seasonId: string
): Promise<ActionResult<{ matchCount: number }>> {
  return initializeStage(seasonId, "playoff");
}
