"use server";

import { revalidatePath } from "next/cache";
import { eq, and, count, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, auditLogs } from "@/db/schema";
import { ok, fail } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { generateBracket, advanceMatch as bracketAdvance, seedPlayoff } from "@/lib/bracket";
import { calculateStandings } from "@/lib/standings";
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

    const { data, resolvedMatches } = await generateBracket(seasonTeams, {
      qualifierFormat: season.qualifierFormat ?? null,
      playoffFormat: season.playoffFormat ?? null,
    });

    // 确定 qualifier stage id（若存在）
    const dbStages = data.stage as Array<{ id: number; name: string }>;
    const qualifierStageId = season.qualifierFormat
      ? (dbStages.find((s) => s.name === "排位赛")?.id ?? null)
      : null;

    // 批量创建 match 记录
    let matchCount = 0;
    for (const bm of resolvedMatches) {
      const teamA = seasonTeams[bm.teamAParticipantId];
      const teamB = seasonTeams[bm.teamBParticipantId];
      if (!teamA || !teamB) continue;

      const stage = qualifierStageId !== null && bm.stageId === qualifierStageId
        ? "qualifier"
        : "playoff";
      // 排位赛默认 BO1，正赛第一轮 BO3
      const format = stage === "qualifier" ? "bo1" : "bo3";

      await db.insert(matches).values({
        seasonId,
        teamAId: teamA.id,
        teamBId: teamB.id,
        stage,
        format,
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
      meta: { matchCount },
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
  stage: "qualifier" | "playoff",
  format: "bo1" | "bo3" | "bo5"
): Promise<ActionResult<{ matchId: string }>> {
  try {
    const session = await requireSeasonAdmin(seasonId);

    if (teamAId === teamBId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "双方队伍不能相同");
    }

    const season = await getSeasonOrThrow(seasonId);

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

        // 正赛阶段的 stage 列表名为"正赛"
        const dbStages = updatedData.stage as Array<{ id: number; name: string }>;
        const playoffStageId = dbStages.find((s) => s.name === "正赛")?.id;
        const stage = playoffStageId !== undefined && bm.stageId === playoffStageId
          ? "playoff"
          : "qualifier";

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

// ── 生成正赛（基于积分榜种子） ────────────────────────────────────────────

/**
 * 在所有排位赛结束后，根据积分榜种子更新正赛 bracket，并创建第一轮对阵。
 * 前置：season.qualifierFormat 非 null，所有 qualifier 场次均为 finished。
 */
export async function generatePlayoff(
  seasonId: string
): Promise<ActionResult<{ matchCount: number }>> {
  try {
    const session = await requireSeasonAdmin(seasonId);
    const season = await getSeasonOrThrow(seasonId);

    if (season.status !== "playing") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有在赛季进行中才能生成正赛");
    }
    if (!season.qualifierFormat) {
      throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "该赛季无排位赛阶段，无需单独生成正赛");
    }
    if (!season.bracketData) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先一键生成赛程");
    }

    // 确认所有排位赛已结束
    const [{ value: unfinished }] = await db
      .select({ value: count() })
      .from(matches)
      .where(
        and(
          eq(matches.seasonId, seasonId),
          eq(matches.stage, "qualifier"),
        )
      )
      // 未结束的场次
      .then(async () =>
        db.select({ value: count() }).from(matches).where(
          and(
            eq(matches.seasonId, seasonId),
            eq(matches.stage, "qualifier"),
            // status NOT 'finished'：用 sql 表达
          )
        )
      );

    // 重新查询：unfinished qualifier 场次数
    const unfinishedCount = await db
      .select({ value: count() })
      .from(matches)
      .where(
        and(
          eq(matches.seasonId, seasonId),
          eq(matches.stage, "qualifier"),
        )
      )
      .then(async (rows) => {
        // 查所有 qualifier 总数
        const total = rows[0]?.value ?? 0;
        const finished = await db
          .select({ value: count() })
          .from(matches)
          .where(
            and(
              eq(matches.seasonId, seasonId),
              eq(matches.stage, "qualifier"),
              eq(matches.status, "finished"),
            )
          );
        return total - (finished[0]?.value ?? 0);
      });

    if (unfinishedCount > 0) {
      throw new AppError(
        ErrorCode.SEASON_INVALID_STATUS,
        `还有 ${unfinishedCount} 场排位赛未结束，无法生成正赛`
      );
    }

    // 检查正赛是否已生成（幂等）
    const [{ value: existingPlayoff }] = await db
      .select({ value: count() })
      .from(matches)
      .where(and(eq(matches.seasonId, seasonId), eq(matches.stage, "playoff")));

    if (existingPlayoff > 0) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "正赛已生成，不可重复生成");
    }

    // 计算积分榜 → 得到种子顺序
    const seasonTeams = await db.query.teams.findMany({
      where: eq(teams.seasonId, seasonId),
      orderBy: [asc(teams.draftOrder)],
    });

    const standings = await calculateStandings(seasonId, seasonTeams);
    // standings 已按种子排序（seed 1 在 index 0）
    const seededNames = standings.map((s) => s.teamName);

    // 更新正赛 bracket 种子
    const { updatedData, resolvedMatches } = await seedPlayoff(
      seededNames,
      season.bracketData as Database
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
    const dbStages = updatedData.stage as Array<{ id: number; name: string }>;
    const playoffStageId = dbStages.find((s) => s.name === "正赛")?.id;

    for (const bm of resolvedMatches) {
      if (playoffStageId === undefined || bm.stageId !== playoffStageId) continue;
      const teamA = participantIdToTeam.get(bm.teamAParticipantId);
      const teamB = participantIdToTeam.get(bm.teamBParticipantId);
      if (!teamA || !teamB) continue;

      await db.insert(matches).values({
        seasonId,
        teamAId: teamA.id,
        teamBId: teamB.id,
        stage: "playoff",
        format: "bo3",
        status: "scheduled",
        bracketNodeId: bm.bracketMatchId.toString(),
      });
      matchCount++;
    }

    await db.insert(auditLogs).values({
      seasonId,
      action: "match.generate_playoff",
      actorId: session.email,
      targetId: seasonId,
      targetType: "season",
      meta: { matchCount, seeds: seededNames },
    });

    revalidatePath(`/admin/${season.slug}/matches`);
    revalidatePath(`/${season.slug}/matches`);

    return ok({ matchCount });
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    console.error("[generatePlayoff]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}
