"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matchVetoSteps, matchMaps, auditLogs } from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { getMatchOrThrow, getSeasonOrThrow, actionError } from "@/lib/action-utils";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { normalizeRegistrationConfig } from "@/types/season";
import type { VetoActionType } from "@/types/match";

function resolveTeamASide(selectedSide: string, selectingTeamId: string | null, teamAId: string): "t" | "ct" | null {
  if (!selectedSide || !selectingTeamId) return null;
  if (selectingTeamId === teamAId) return selectedSide as "t" | "ct";
  return selectedSide === "t" ? "ct" : "t";
}

export interface VetoStepInput {
  actionType: VetoActionType;
  mapName: string;
  teamId: string | null;
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

    if (match.status !== "scheduled" && match.status !== "in_progress") {
      throw new AppError(
        ErrorCode.MATCH_INVALID_TRANSITION,
        "仅「待进行」或「进行中」状态的比赛可录入 BP",
      );
    }

    if (steps.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 步骤不能为空");
    }

    // 服务端输入校验
    if (steps.some((s) => !s.mapName.trim())) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "所有步骤必须指定地图");
    }
    if (steps.some((s) => s.actionType !== "decider" && !s.teamId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "非 decider 步骤必须指定操作队伍");
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
      // 清除旧记录（支持重复录入）
      await tx
        .delete(matchVetoSteps)
        .where(eq(matchVetoSteps.matchId, matchId));

      // 写入 BP 步骤
      await tx.insert(matchVetoSteps).values(
        steps.map((s, i) => ({
          matchId,
          stepOrder: i + 1,
          actionType: s.actionType,
          mapName: s.mapName,
          teamId: s.teamId,
          side: s.side ?? null,
        })),
      );

      // 从 pick / decider 步骤自动创建 match_maps 记录
      const playMaps = steps.filter(
        (s) => s.actionType === "pick" || s.actionType === "decider",
      );

      await tx.delete(matchMaps).where(eq(matchMaps.matchId, matchId));

      if (playMaps.length > 0) {
        await tx.insert(matchMaps).values(
          playMaps.map((s, i) => ({
            matchId,
            mapOrder: i + 1,
            mapName: s.mapName,
            pickedByTeamId: s.actionType === "pick" ? s.teamId : null,
            teamAStartSide: resolveTeamASide(s.side ?? "", s.teamId, match.teamAId),
          })),
        );
      }

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.save_veto",
        actorId: auditActorId(session),
        targetId: matchId,
        targetType: "match",
        meta: { format: match.format, stepCount: steps.length },
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
