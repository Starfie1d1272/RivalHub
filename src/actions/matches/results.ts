"use server";

import { eq, and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, matchMaps, matchVetoSteps, matchRosters, matchRosterPlayers, competitionEntries, auditLogs, matchTimeProposals } from "@/db/schema";
import { ok } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { advanceMatch as bracketAdvance, collectResolvedMatches, loadBracketState, saveBracketState, type BracketStageRef, type ResolvedBracketMatch } from "@/lib/bracket";
import type { BracketDatabase as Database } from "@/lib/bracket";
import {
  assertMatchTransition,
  resolveMatchFormat,
} from "@/lib/match-transitions";
import { getMaxMaps, getWinThreshold, isMatchStatus } from "@/types/match";
import { actionError, getSeasonOrThrow, getMatchOrThrow } from "@/lib/action-utils";
import {
  applyMatchStatusTransitionInTx,
  lockMatchInTx,
} from "@/lib/match-rosters/service";
import { maybeFinishSeason } from "@/actions/transitions";
import { revalidateMatchPaths, revalidateSeasonPaths } from "@/lib/revalidation";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/types/season";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import {
  computeSeriesScoreAfterMap,
  isValidCS2RoundScore,
  validateMapScore,
  validateSeriesScore,
} from "@/lib/matches/result-rules";

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
  const seasonTeams = await tx.query.competitionEntries.findMany({
    where: eq(competitionEntries.competitionId, seasonId),
  });
  const participants = updatedData.participant as { id: number; name: string }[];
  const participantNameById = new Map(participants.map((p) => [p.id, p.name]));
  const teamByName = new Map(seasonTeams.map((t) => [t.name, t]));
  const dbStages = updatedData.stage as BracketStageRef[];
  for (const bm of resolvedMatches) {
    const nameA = participantNameById.get(bm.teamAParticipantId);
    const nameB = participantNameById.get(bm.teamBParticipantId);
    const teamA = nameA ? teamByName.get(nameA) : undefined;
    const teamB = nameB ? teamByName.get(nameB) : undefined;
    if (!teamA || !teamB) continue;
    const bmStageName = dbStages.find((s) => s.id === bm.stageId)?.name;
    const stage = stagePlan.find((s) => s.name === bmStageName)?.key ?? defaultStage;
    await tx.insert(matches).values({
      seasonId,
      entryAId: teamA.id,
      entryBId: teamB.id,
      stage,
      format: resolveMatchFormat(stagePlan, stage, bm.roundNumber, bm.groupNumber),
      status: "scheduled",
      bracketNodeId: bm.bracketMatchId.toString(),
    });
  }
}

// ── 更新比赛状态 ──────────────────────────────────────────────────────────

/**
 * 将比赛状态推进一步（scheduled→in_progress，scheduled/in_progress→cancelled）。
 * 开始比赛（in_progress）要求两队均已提交并由管理员确认首发阵容；
 * 不存在任何隐式补名单路径。核心事务体见
 * lib/match-rosters/service.ts#applyMatchStatusTransitionInTx。
 */
export async function updateMatchStatus(
  matchId: string,
  nextStatus: "in_progress" | "cancelled"
): Promise<ActionResult<void>> {
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);
    if (!isMatchStatus(match.status)) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, `无效的比赛状态: ${match.status}`);
    }
    assertMatchTransition(match.status, nextStatus);

    const seasonForStatus = await getSeasonOrThrow(match.seasonId);
    await db.transaction(async (tx) => {
      await applyMatchStatusTransitionInTx(tx, {
        matchId,
        nextStatus,
        actorId: auditActorId(session),
      });

      if (nextStatus === "cancelled") {
        await maybeFinishSeason(tx, match.seasonId);
      }
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
    const match = await getMatchOrThrow(matchId);
    validateSeriesScore(match.format, scoreA, scoreB);
    const session = await requireSeasonAdmin(match.seasonId);
    if (!isMatchStatus(match.status)) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, `无效的比赛状态: ${match.status}`);
    }
    assertMatchTransition(match.status, "finished");

    const season = await getSeasonOrThrow(match.seasonId);

    // 事务保护：score 更新 + bracket 推进 + audit 原子化
    await db.transaction(async (tx) => {
      const locked = await lockMatchInTx(tx, matchId);
      if (!isMatchStatus(locked.status)) throw new AppError(ErrorCode.INTERNAL_ERROR, `无效的比赛状态: ${locked.status}`);
      assertMatchTransition(locked.status, "finished");
      validateSeriesScore(locked.format, scoreA, scoreB);
      const hasVeto = await tx.query.matchVetoSteps.findFirst({ where: eq(matchVetoSteps.matchId, matchId), columns: { id: true } });
      if (!hasVeto) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先录入 BP 再录入比分");
      const [lockedSeason] = await tx.select().from(seasons).where(eq(seasons.id, locked.seasonId)).for("update");
      if (!lockedSeason) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
      const bracketState = await loadBracketState(tx, locked.seasonId);
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
      if (bracketState && locked.bracketNodeId) {
        const { updatedData, newResolvedMatches } = await bracketAdvance(
          locked.bracketNodeId,
          scoreA,
          scoreB,
          bracketState,
        );

        await saveBracketState(tx, match.seasonId, updatedData);

        await insertResolvedBracketMatches(
          tx, match.seasonId, match.stage,
          updatedData as Database, newResolvedMatches,
          normalizeStagePlan(lockedSeason.stagePlan),
        );
      }

      await maybeFinishSeason(tx, match.seasonId);

      await tx.insert(auditLogs).values({
        seasonId: locked.seasonId,
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
  pickedByEntryId: string | null,
  teamAStartSide: "t" | "ct" | null
): Promise<ActionResult<{ seriesFinished: boolean }>> {
  try {
    validateMapScore(scoreA, scoreB);

    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.status !== "in_progress") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛状态不允许录入地图结果");
    }

    const season = await getSeasonOrThrow(match.seasonId);
    const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
    if (!mapPool.includes(mapName)) {
      throw new AppError(ErrorCode.MATCH_MAP_INVALID, "地图不在当前赛季图池中");
    }

    const maxMaps = getMaxMaps(match.format);

    if (mapOrder < 1 || mapOrder > maxMaps) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `${match.format.toUpperCase()} 图序号须在 1-${maxMaps} 之间`);
    }

    // 所有写操作及其依赖的读操作放入同一事务，防止 TOCTOU
    let seriesFinished = false;

    await db.transaction(async (tx) => {
      const locked = await lockMatchInTx(tx, matchId);
      if (locked.status !== "in_progress") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛状态不允许录入地图结果");
      const hasVeto = await tx.query.matchVetoSteps.findFirst({ where: eq(matchVetoSteps.matchId, matchId), columns: { id: true } });
      if (!hasVeto) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先录入 BP 再录入地图结果");
      const [lockedSeason] = await tx.select().from(seasons).where(eq(seasons.id, locked.seasonId)).for("update");
      if (!lockedSeason) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
      const bracketState = await loadBracketState(tx, locked.seasonId);
      const lockedPool = normalizeRegistrationConfig(lockedSeason.registrationConfig).mapPool;
      if (!lockedPool.includes(mapName)) throw new AppError(ErrorCode.MATCH_MAP_INVALID, "地图不在当前赛季图池中");
      const lockedMaxMaps = getMaxMaps(locked.format);
      if (mapOrder < 1 || mapOrder > lockedMaxMaps) throw new AppError(ErrorCode.VALIDATION_FAILED, `${locked.format.toUpperCase()} 图序号须在 1-${lockedMaxMaps} 之间`);
      // 事务内读快照
      const existingMaps = await tx.query.matchMaps.findMany({
        where: eq(matchMaps.matchId, matchId),
      });
      const existingRow = existingMaps.find((m) => m.mapName === mapName);
      if (existingRow && existingRow.scoreA !== null) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `地图 ${mapName} 已录入比分`);
      }

      const seriesScore = computeSeriesScoreAfterMap(locked.format, existingMaps, scoreA, scoreB);
      const { mapWinsA, mapWinsB } = seriesScore;
      seriesFinished = seriesScore.seriesFinished;

      if (existingRow) {
        // BP 预占行：填入比分（pickedByEntryId / teamAStartSide 保留 BP 记录，除非调用方覆盖）
        await tx.update(matchMaps)
          .set({
            scoreA,
            scoreB,
            pickedByEntryId: pickedByEntryId ?? existingRow.pickedByEntryId,
            teamAStartSide: teamAStartSide ?? existingRow.teamAStartSide,
            completedAt: new Date(),
          })
          .where(eq(matchMaps.id, existingRow.id));
      } else {
        await tx.insert(matchMaps).values({
          matchId,
          mapOrder,
          mapName,
          pickedByEntryId,
          teamAStartSide,
          scoreA,
          scoreB,
          completedAt: new Date(),
        });
      }

      if (seriesFinished) {
        await tx.delete(matchMaps).where(
          and(eq(matchMaps.matchId, matchId), isNull(matchMaps.scoreA))
        );

        await tx.update(matches).set({
          scoreA: mapWinsA,
          scoreB: mapWinsB,
          status: "finished",
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(matches.id, matchId));

        if (bracketState && locked.bracketNodeId) {
          const { updatedData, newResolvedMatches } = await bracketAdvance(
            locked.bracketNodeId,
            mapWinsA,
            mapWinsB,
            bracketState,
          );
          await saveBracketState(tx, match.seasonId, updatedData);
          await insertResolvedBracketMatches(
            tx, match.seasonId, match.stage,
            updatedData as Database, newResolvedMatches,
            normalizeStagePlan(lockedSeason.stagePlan),
          );
        }

        await maybeFinishSeason(tx, match.seasonId);
      }

      await tx.insert(auditLogs).values({
        seasonId: locked.seasonId,
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
      await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
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

// ── 修正已完成比赛的比分 ──────────────────────────────────────────────────

/**
 * 修正已完成比赛的比分（只允许不改变胜者的纠错）。
 * 改变胜者的修正会与已推进的 bracket 结果矛盾，当前版本无法安全重建后续赛程，一律拒绝。
 * BO1 合法胜者回合数：13、16、19、22、…（MR12 公式：13 + 3k，k ≥ 0）。
 */
export async function correctMatchScore(
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
    if (match.status !== "finished") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只能修正已完成比赛的比分");
    }

    if (match.format === "bo1") {
      const winner = Math.max(scoreA, scoreB);
      const loser = Math.min(scoreA, scoreB);
      if (!isValidCS2RoundScore(winner, loser)) {
        throw new AppError(
          ErrorCode.MATCH_INVALID_SCORE,
          "BO1 比分不合法，胜者回合数须满足 13 + 3k（如 13、16、19、22…）"
        );
      }
    } else {
      const maxWins = getWinThreshold(match.format);
      const winner = Math.max(scoreA, scoreB);
      const loser = Math.min(scoreA, scoreB);
      if (winner !== maxWins || loser >= maxWins) {
        throw new AppError(
          ErrorCode.MATCH_INVALID_SCORE,
          `${match.format.toUpperCase()} 系列赛比分不合法（胜者须恰好赢 ${maxWins} 图）`
        );
      }
    }

    // winner guard：拒绝改变胜者的纠错（当前版本无法安全重建 downstream bracket）
    const prevWinner =
      match.scoreA !== null && match.scoreB !== null
        ? match.scoreA > match.scoreB
          ? match.entryAId
          : match.entryBId
        : null;
    const nextWinner = scoreA > scoreB ? match.entryAId : match.entryBId;
    if (prevWinner !== null && prevWinner !== nextWinner) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        "该修正会改变比赛胜者。当前版本无法安全重建后续赛程，请勿直接修改；需通过赛事事故处理流程解决。"
      );
    }

    const session = await requireSeasonAdmin(match.seasonId);
    const season = await getSeasonOrThrow(match.seasonId);
    const prevScoreA = match.scoreA;
    const prevScoreB = match.scoreB;

    await db.transaction(async (tx) => {
      await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
      await tx
        .update(matches)
        .set({ scoreA, scoreB, updatedAt: new Date() })
        .where(eq(matches.id, matchId));

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.correct_score",
        actorId: session.email,
        targetId: matchId,
        targetType: "match",
        meta: { prevScoreA, prevScoreB, scoreA, scoreB },
      });
    });

    revalidateMatchPaths(season.slug, matchId);
    return ok(undefined);
  } catch (e) {
    return actionError("correctMatchScore", e);
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
      await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
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
        meta: { stage: match.stage, format: match.format, entryAId: match.entryAId, entryBId: match.entryBId },
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

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "update_match_completed_at",
        actorId: auditActorId(session),
        targetId: matchId,
        targetType: "match",
        meta: { completedAt: completedAt?.toISOString() ?? null },
      });
    });

    revalidateMatchPaths(season.slug, matchId);
    return ok(undefined);
  } catch (e) {
    return actionError("updateMatchCompletedAt", e);
  }
}

// ── 修正单图比分 ──────────────────────────────────────────────────────────────

/**
 * 修正已完成比赛中某张地图的比分，并按正常录分语义重算系列赛大比分。
 * 与 recordMapResult 共享同一套比分合法性（MR12），且只允许不改变系列赛胜者的修正；
 * 会改变胜者或无法构成完整系列赛的修正一律拒绝（fail closed），不影响 bracket。
 */
export async function correctMapScore(
  mapId: string,
  scoreA: number,
  scoreB: number,
): Promise<ActionResult<void>> {
  try {
    // 与正常录分共享同一套单图比分合法性（MR12：胜者 13 + 3k）
    validateMapScore(scoreA, scoreB);

    const mapRecord = await db.query.matchMaps.findFirst({
      where: eq(matchMaps.id, mapId),
    });
    if (!mapRecord) throw new AppError(ErrorCode.NOT_FOUND, "地图记录不存在");
    if (mapRecord.scoreA === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "该图尚未录入比分，无法修正");
    }

    const match = await getMatchOrThrow(mapRecord.matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.status !== "finished") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有已结束的比赛才能修正比分");
    }

    const season = await getSeasonOrThrow(match.seasonId);

    await db.transaction(async (tx) => {
      await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
      // 事务内读取所有图，将目标图替换为 proposed score 后按正常语义重算系列赛
      const allMaps = await tx.query.matchMaps.findMany({
        where: eq(matchMaps.matchId, mapRecord.matchId),
      });
      const otherMaps = allMaps.filter((m) => m.id !== mapId);
      const { mapWinsA, mapWinsB, seriesFinished } = computeSeriesScoreAfterMap(
        match.format,
        otherMaps,
        scoreA,
        scoreB,
      );

      // 修正后必须仍是合法、确定、已完结的系列赛比分（禁止写成 1:1 之类不完整状态）
      if (!seriesFinished || mapWinsA === mapWinsB) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          "修正后系列赛无法构成完整比分，已拒绝修正。",
        );
      }

      // winner guard：拒绝改变系列赛胜者的纠错（当前版本无法安全重建 downstream bracket）
      const existingWinner =
        match.scoreA !== null && match.scoreB !== null
          ? match.scoreA > match.scoreB
            ? match.entryAId
            : match.entryBId
          : null;
      const proposedWinner = mapWinsA > mapWinsB ? match.entryAId : match.entryBId;
      if (existingWinner !== null && existingWinner !== proposedWinner) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          "该修正会改变比赛胜者。当前版本无法安全重建后续赛程，请勿直接修改；需通过赛事事故处理流程解决。",
        );
      }

      await tx.update(matchMaps)
        .set({ scoreA, scoreB })
        .where(eq(matchMaps.id, mapId));

      await tx.update(matches)
        .set({ scoreA: mapWinsA, scoreB: mapWinsB, updatedAt: new Date() })
        .where(eq(matches.id, mapRecord.matchId));

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.correct_map_score",
        actorId: auditActorId(session),
        targetId: mapRecord.matchId,
        targetType: "match",
        meta: { mapId, mapName: mapRecord.mapName, prevScoreA: mapRecord.scoreA, prevScoreB: mapRecord.scoreB, scoreA, scoreB, seriesA: mapWinsA, seriesB: mapWinsB },
      });
    });

    revalidateMatchPaths(season.slug, mapRecord.matchId);
    return ok(undefined);
  } catch (e) {
    return actionError("correctMapScore", e);
  }
}

// ── 修复缺失的 bracket 比赛 ───────────────────────────────────────────────────

/**
 * 扫描当前 bracket state，将已确定对阵但 DB 中缺失的比赛补全。
 * 用于修复历史 bug 导致的漏创建情况，正常流程不需要调用。
 */
export async function syncBracketMatches(seasonId: string): Promise<ActionResult<{ created: number; fixed: number }>> {
  try {
    await requireSeasonAdmin(seasonId);
    const season = await getSeasonOrThrow(seasonId);
    const bracketState = await loadBracketState(db, seasonId);
    if (!bracketState) return ok({ created: 0, fixed: 0 });

    const allResolved = collectResolvedMatches(bracketState);
    const stagePlan = normalizeStagePlan(season.stagePlan);
    const dbStages = bracketState.stage as BracketStageRef[];

    // 建立 participant id → team 的正确映射（名称查找）
    const seasonTeams = await db.query.competitionEntries.findMany({ where: eq(competitionEntries.competitionId, seasonId) });
    const teamByName = new Map(seasonTeams.map((t) => [t.name, t]));
    const participants = bracketState.participant as { id: number; name: string }[];
    const participantNameById = new Map(participants.map((p) => [p.id, p.name]));

    // bracket stage id → 赛季 stage key 映射
    const stageIdToKey = new Map<number, string>();
    for (const s of dbStages) {
      const sk = stagePlan.find((p) => p.name === s.name)?.key;
      if (sk) stageIdToKey.set(s.id, sk);
    }

    // 读取现有 bracket match 记录，按 (bracketNodeId, stage) 索引
    // 不同 stage（qualifier vs playoff）可能共享同一 bracketNodeId
    const existingBracketMatches = await db.query.matches.findMany({
      where: eq(matches.seasonId, seasonId),
      columns: { id: true, bracketNodeId: true, stage: true, entryAId: true, entryBId: true },
    });
    const existingByKey = new Map<string, typeof existingBracketMatches[number]>();
    for (const m of existingBracketMatches) {
      if (m.bracketNodeId && m.stage) {
        existingByKey.set(`${m.bracketNodeId}:${m.stage}`, m);
      }
    }

    let created = 0;
    let fixed = 0;

    await db.transaction(async (tx) => {
      await assertSeasonAllowsTournamentMutationInTx(tx, seasonId);
      for (const bm of allResolved) {
        const nameA = participantNameById.get(bm.teamAParticipantId);
        const nameB = participantNameById.get(bm.teamBParticipantId);
        const teamA = nameA ? teamByName.get(nameA) : undefined;
        const teamB = nameB ? teamByName.get(nameB) : undefined;
        if (!teamA || !teamB) continue;

        const nodeIdStr = bm.bracketMatchId.toString();
        const stage = stageIdToKey.get(bm.stageId) ?? "playoff";
        const existing = existingByKey.get(`${nodeIdStr}:${stage}`);

        if (!existing) {
          await tx.insert(matches).values({
            seasonId,
            entryAId: teamA.id,
            entryBId: teamB.id,
            stage,
            format: resolveMatchFormat(stagePlan, stage, bm.roundNumber, bm.groupNumber),
            status: "scheduled",
            bracketNodeId: nodeIdStr,
          });
          created++;
        } else if (existing.entryAId !== teamA.id || existing.entryBId !== teamB.id) {
          await tx.update(matches)
            .set({ entryAId: teamA.id, entryBId: teamB.id, updatedAt: new Date() })
            .where(eq(matches.id, existing.id));
          fixed++;
        }
      }
    });

    return ok({ created, fixed });
  } catch (e) {
    return actionError("syncBracketMatches", e);
  }
}

// ── 弃赛判负 ─────────────────────────────────────────────────────────────────

const FORFEIT_WINNER_SCORE: Record<"bo1" | "bo3" | "bo5", number> = {
  bo1: 13,
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

    const winnerScore = FORFEIT_WINNER_SCORE[match.format];
    const isLoserA = loserTeamId === match.entryAId;
    const scoreA = isLoserA ? 0 : winnerScore;
    const scoreB = isLoserA ? winnerScore : 0;

    const season = await getSeasonOrThrow(match.seasonId);

    await db.transaction(async (tx) => {
      await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
      await tx.delete(matchMaps).where(
        and(eq(matchMaps.matchId, matchId), isNull(matchMaps.scoreA))
      );

      await tx
        .update(matches)
        .set({
          scoreA,
          scoreB,
          status: "finished",
          isForfeit: true,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(matches.id, matchId));

      const bracketState = await loadBracketState(tx, match.seasonId);
      if (bracketState && match.bracketNodeId) {
        const { updatedData, newResolvedMatches } = await bracketAdvance(
          match.bracketNodeId,
          scoreA,
          scoreB,
          bracketState,
        );
        await saveBracketState(tx, match.seasonId, updatedData);
        await insertResolvedBracketMatches(
          tx, match.seasonId, match.stage,
          updatedData as Database, newResolvedMatches,
          normalizeStagePlan(season.stagePlan),
        );
      }

      await maybeFinishSeason(tx, match.seasonId);

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.forfeit",
        actorId: auditActorId(session),
        targetId: matchId,
        targetType: "match",
        meta: { loserTeamId, scoreA, scoreB, format: match.format, reason: normalizedReason },
      });
    });

    revalidateMatchPaths(season.slug, matchId);
    return ok(undefined);
  } catch (e) {
    return actionError("forfeitMatch", e);
  }
}
