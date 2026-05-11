"use server";

import { eq, and, count, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, auditLogs } from "@/db/schema";
import { ok, fail } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getExecutor } from "@/lib/formats";
import {
  getFirstStage,
  getPreviousStage,
  normalizeStagePlan,
} from "@/types/season";
import { actionError, getSeasonOrThrow } from "@/lib/action-utils";
import { revalidateSeasonPaths } from "@/lib/revalidation";

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
    // 首阶段参赛队伍：有 seeds 时按 seed 筛选，否则取 top teamCount（draft_order 即种子序）
    const stageTeams = firstStage.seeds && firstStage.seeds.length > 0
      ? seasonTeams.filter((_, i) => firstStage.seeds!.includes(i + 1))
      : seasonTeams.slice(0, firstStage.teamCount);

    const { matchCount } = await getExecutor(firstStage.type).initialize(
      seasonId,
      firstStage,
      stageTeams,
    );

    // Audit
    await db.insert(auditLogs).values({
      seasonId,
      action: "match.generate_schedule",
      actorId: session.email,
      targetId: seasonId,
      targetType: "season",
      meta: { matchCount, stageKey: firstStage.key },
    });

    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);

    return ok({ matchCount });
  } catch (e) {
    return actionError("generateSchedule", e);
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

    const [newMatch] = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(matches)
        .values({ seasonId, teamAId, teamBId, stage, format, status: "scheduled" })
        .returning({ id: matches.id });

      await tx.insert(auditLogs).values({
        seasonId,
        action: "match.create",
        actorId: session.email,
        targetId: row.id,
        targetType: "match",
        meta: { teamAId, teamBId, stage, format },
      });

      return [row];
    });

    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);

    return ok({ matchId: newMatch.id });
  } catch (e) {
    return actionError("createMatch", e);
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
    const stagePlan = normalizeStagePlan(season.stagePlan);
    const stage = stagePlan.find((s) => s.key === stageKey);
    if (!stage) {
      throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "该赛季没有这个赛程阶段");
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

    const seasonTeams = await db.query.teams.findMany({
      where: eq(teams.seasonId, seasonId),
      orderBy: [asc(teams.draftOrder)],
    });

    const qualifiers = await getExecutor(previousStage.type).getQualifiers(seasonId, previousStage);

    // 构建本阶段参赛队伍：entry seeds（直入） + 上一阶段晋级
    const qualifierIds = new Set(qualifiers.map((q) => q.teamId));
    const entryCount = stage.entrySeeds ?? 0;
    const entryTeams = entryCount > 0
      ? seasonTeams.filter((t) => !qualifierIds.has(t.id)).slice(0, entryCount)
      : [];
    const qualTeams = seasonTeams.filter((t) => qualifierIds.has(t.id));
    const stageTeams = [...entryTeams, ...qualTeams];

    if (stageTeams.length !== stage.teamCount) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `${stage.name} 预期 ${stage.teamCount} 队，实际 ${stageTeams.length} 队（直入 ${entryTeams.length} + 晋级 ${qualTeams.length}），请检查 entrySeeds 与上一阶段晋级配置`,
      );
    }

    const { matchCount } = await getExecutor(stage.type).initialize(seasonId, stage, stageTeams, qualifiers);

    await db.insert(auditLogs).values({
      seasonId,
      action: "match.initialize_stage",
      actorId: session.email,
      targetId: seasonId,
      targetType: "season",
      meta: { matchCount, stageKey: stage.key },
    });

    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);

    return ok({ matchCount });
  } catch (e) {
    return actionError("initializeStage", e);
  }
}

/**
 * 向后兼容现有 UI：自动查找 stagePlan 中最后一个淘汰赛阶段并初始化。
 */
export async function generatePlayoff(
  seasonId: string
): Promise<ActionResult<{ matchCount: number }>> {
  const season = await getSeasonOrThrow(seasonId);
  const stagePlan = normalizeStagePlan(season.stagePlan);
  const playoff = [...stagePlan].reverse().find(
    (s) => s.type === "double_elim" || s.type === "single_elim",
  );
  if (!playoff) {
    return fail({
      code: ErrorCode.SEASON_CAPABILITY_DISABLED,
      message: "该赛季没有淘汰赛阶段",
    });
  }
  return initializeStage(seasonId, playoff.key);
}
