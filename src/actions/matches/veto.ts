"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matchVetoSteps, matchVetoSessions, matchMaps } from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { getMatchOrThrow, getSeasonOrThrow, actionError } from "@/lib/action-utils";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import type { VetoActionType } from "@/types/match";
import { lockMatchInTx } from "@/lib/match-rosters/service";
import { legacyVetoStepsToFacts, projectVetoMapPlan } from "@/lib/matches/veto-sequence";

export interface VetoStepInput {
  actionType: VetoActionType;
  mapName: string;
  entryId: string | null;
  side?: "t" | "ct" | null;
}

export async function saveVetoSteps(
  matchId: string,
  input: { steps: VetoStepInput[] },
): Promise<ActionResult<void>> {
  const { steps } = input;
  try {
    const match = await getMatchOrThrow(matchId);
    const session = await requireSeasonAdmin(match.seasonId);

    if (match.status !== "finished") {
      throw new AppError(
        ErrorCode.MATCH_INVALID_TRANSITION,
        "在线 BP 必须在 Veto Room 完成；该入口仅用于赛后补录历史步骤。",
      );
    }

    if (steps.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 步骤不能为空");
    }

    // 服务端输入校验
    if (steps.some((s) => !s.mapName.trim())) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "所有步骤必须指定地图");
    }
    if (steps.some((s) => s.actionType !== "decider" && !s.entryId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "非 decider 步骤必须指定操作队伍");
    }
    if (steps.some((s) => s.actionType === "decider" && s.side && !s.entryId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "decider 指定了选边时必须指定选边队伍");
    }
    const mapNames = steps.map((s) => s.mapName);
    if (new Set(mapNames).size !== mapNames.length) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "地图不能重复");
    }
    const season = await getSeasonOrThrow(match.seasonId);
    const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
    if (steps.some((s) => !mapPool.includes(s.mapName))) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "地图不属于当前赛季图池");
    }

    await db.transaction(async (tx) => {
      const locked = await lockMatchInTx(tx, matchId);
      if (locked.status !== "finished") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有已结束比赛可以补录历史 BP 步骤。");
      const [onlineSession] = await tx.select({ startedAt: matchVetoSessions.startedAt })
        .from(matchVetoSessions)
        .where(eq(matchVetoSessions.matchId, matchId))
        .for("update");
      if (onlineSession?.startedAt) throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "本场已在 Veto Room 留下操作记录，不能再用赛后补录修改。");
      const mapPlan = projectVetoMapPlan({
        steps: legacyVetoStepsToFacts(locked.format, steps, locked.entryAId, locked.entryBId),
        entryAId: locked.entryAId,
        format: locked.format,
      });
      // 清除旧 BP 记录（支持重复录入）
      await tx.delete(matchVetoSteps).where(eq(matchVetoSteps.matchId, matchId));

      // 写入 BP 步骤
      await tx.insert(matchVetoSteps).values(
        steps.map((s, i) => ({
          matchId,
          stepOrder: i + 1,
          actionType: s.actionType,
          mapName: s.mapName,
          entryId: s.entryId,
          side: s.side ?? null,
        })),
      );

      // 比赛已结束时：仅在无 match_maps 记录时重建（供赛后 OCR 使用），
      // 有记录（含已录入比分的行）时跳过，保护历史数据。
      const existingMaps = await tx.query.matchMaps.findMany({
        where: eq(matchMaps.matchId, matchId),
      });
      if (existingMaps.length === 0 && mapPlan.length > 0) {
        await tx.insert(matchMaps).values(
          mapPlan.map((map) => ({
            matchId,
            ...map,
          })),
        );
      }

      await writeAuditInTx(tx, {
        seasonId: locked.seasonId,
        action: "match.save_veto",
        actorId: auditActorId(session),
        targetId: matchId,meta: { format: locked.format, stepCount: steps.length, postMatch: locked.status === "finished" },
      });
    });

    revalidateMatchPaths(season.slug, matchId);

    return ok(undefined);
  } catch (e) {
    return actionError("saveVetoSteps", e);
  }
}

/**
 * 查询某场比赛已保存的 BP 步骤（按顺序）
 */
export async function getMatchVetoSteps(matchId: string) {
  return db.query.matchVetoSteps.findMany({
    where: eq(matchVetoSteps.matchId, matchId),
    orderBy: (t, { asc }) => [asc(t.stepOrder)],
  });
}
