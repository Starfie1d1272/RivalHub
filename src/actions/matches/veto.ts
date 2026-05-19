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

    const allowedStatuses = ["scheduled", "in_progress", "finished"] as const;
    if (!(allowedStatuses as readonly string[]).includes(match.status)) {
      throw new AppError(
        ErrorCode.MATCH_INVALID_TRANSITION,
        "仅「待进行」「进行中」或「已结束」状态的比赛可录入 BP",
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

    const playMaps = steps.filter(
      (s) => s.actionType === "pick" || s.actionType === "decider",
    );

    await db.transaction(async (tx) => {
      // 清除旧 BP 记录（支持重复录入）
      await tx.delete(matchVetoSteps).where(eq(matchVetoSteps.matchId, matchId));

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

      // 比赛已结束时：仅在无 match_maps 记录时重建（供赛后 OCR 使用），
      // 有记录（含已录入比分的行）时跳过，保护历史数据。
      if (match.status === "finished") {
        const existingMaps = await tx.query.matchMaps.findMany({
          where: eq(matchMaps.matchId, matchId),
        });
        if (existingMaps.length === 0 && playMaps.length > 0) {
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
      } else {
        // 进行中 / 待进行：若已有带比分的地图行则拒绝覆盖
        const existingMaps = await tx.query.matchMaps.findMany({
          where: eq(matchMaps.matchId, matchId),
        });
        if (existingMaps.some((m) => m.scoreA != null)) {
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            "已有地图录入了比分，无法重新录入 BP。如需补录请在赛后操作。",
          );
        }
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
      }

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.save_veto",
        actorId: auditActorId(session),
        targetId: matchId,
        targetType: "match",
        meta: { format: match.format, stepCount: steps.length, postMatch: match.status === "finished" },
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
