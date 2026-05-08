"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { seasons } from "@/db/schema/seasons";
import { teams } from "@/db/schema/teams";

import { matches } from "@/db/schema/matches";
import { matchMaps } from "@/db/schema/match-maps";
import { auditLogs } from "@/db/schema/audit";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth/session";
import { ok, fail, type ActionResult } from "@/types/action";
import {
  createMatchSchema,
  recordMatchResultSchema,
  type CreateMatchInput,
  type RecordMatchResultInput,
} from "@/lib/validators/match";

const FORMAT_MAX_MAPS: Record<string, number> = { bo1: 1, bo3: 3, bo5: 5 };

export async function createMatch(
  input: CreateMatchInput
): Promise<ActionResult<{ matchId: string }>> {
  try {
    const admin = await requireAdmin();

    const parsed = createMatchSchema.safeParse(input);
    if (!parsed.success) {
      return fail({
        code: ErrorCode.VALIDATION_FAILED,
        message: ERROR_MESSAGES.VALIDATION_FAILED,
        fieldErrors: Object.fromEntries(
          Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [
            k,
            v?.[0] ?? "",
          ])
        ),
      });
    }

    const { seasonId, teamAId, teamBId, stage, format, scheduledAt } = parsed.data;

    if (teamAId === teamBId) {
      return fail({ code: ErrorCode.VALIDATION_FAILED, message: "两支队伍不能相同" });
    }

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) {
      return fail({ code: ErrorCode.SEASON_NOT_FOUND, message: ERROR_MESSAGES.SEASON_NOT_FOUND });
    }
    if (season.status !== "playing") {
      return fail({
        code: ErrorCode.SEASON_INVALID_STATUS,
        message: "只有处于 playing 状态的赛季才能创建比赛",
      });
    }

    const [teamA, teamB] = await db
      .select()
      .from(teams)
      .where(inArray(teams.id, [teamAId, teamBId]));
    if (!teamA || !teamB) {
      return fail({ code: ErrorCode.NOT_FOUND, message: "队伍不存在" });
    }
    if (teamA.seasonId !== seasonId || teamB.seasonId !== seasonId) {
      return fail({ code: ErrorCode.VALIDATION_FAILED, message: "队伍不属于该赛季" });
    }

    const matchId = await db.transaction(async (tx) => {
      // 在事务内再次校验队伍归属，防止并发创建时队伍已被移走
      const txTeams = await tx
        .select({ id: teams.id, seasonId: teams.seasonId })
        .from(teams)
        .where(inArray(teams.id, [teamAId, teamBId]));
      const txTeamA = txTeams.find((t) => t.id === teamAId);
      const txTeamB = txTeams.find((t) => t.id === teamBId);
      if (!txTeamA || !txTeamB) {
        throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在");
      }
      if (txTeamA.seasonId !== seasonId || txTeamB.seasonId !== seasonId) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍不属于该赛季");
      }

      const [match] = await tx
        .insert(matches)
        .values({
          seasonId,
          teamAId,
          teamBId,
          stage,
          format,
          status: "scheduled",
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        })
        .returning({ id: matches.id });

      await tx.insert(auditLogs).values({
        seasonId,
        action: "match.create",
        actorId: admin.adminId,
        targetId: match.id,
        targetType: "match",
        meta: { stage, format, teamAId, teamBId },
      });

      return match.id;
    });

    revalidatePath(`/admin/${season.slug}/matches`);
    return ok({ matchId });
  } catch (e) {
    if (e instanceof AppError) {
      return fail({ code: e.code, message: e.message });
    }
    console.error("[createMatch]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

export async function recordMatchResult(
  input: RecordMatchResultInput
): Promise<ActionResult<{ matchId: string }>> {
  try {
    const admin = await requireAdmin();

    const parsed = recordMatchResultSchema.safeParse(input);
    if (!parsed.success) {
      return fail({
        code: ErrorCode.VALIDATION_FAILED,
        message: ERROR_MESSAGES.VALIDATION_FAILED,
        fieldErrors: Object.fromEntries(
          Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [
            k,
            v?.[0] ?? "",
          ])
        ),
      });
    }

    const { matchId, scoreA, scoreB, maps } = parsed.data;

    const match = await db.query.matches.findFirst({
      where: eq(matches.id, matchId),
    });
    if (!match) {
      return fail({ code: ErrorCode.MATCH_NOT_FOUND, message: ERROR_MESSAGES.MATCH_NOT_FOUND });
    }
    if (match.status === "finished" || match.status === "cancelled") {
      return fail({
        code: ErrorCode.MATCH_INVALID_TRANSITION,
        message: ERROR_MESSAGES.MATCH_INVALID_TRANSITION,
      });
    }

    if (maps && maps.length > 0) {
      const maxMaps = FORMAT_MAX_MAPS[match.format] ?? 1;
      if (maps.length > maxMaps) {
        return fail({
          code: ErrorCode.MATCH_FORMAT_MISMATCH,
          message: `${match.format.toUpperCase()} 最多 ${maxMaps} 张图，提交了 ${maps.length} 张`,
        });
      }
      const mapOrders = maps.map((m) => m.mapOrder);
      if (new Set(mapOrders).size !== mapOrders.length) {
        return fail({
          code: ErrorCode.MATCH_MAP_ORDER_CONFLICT,
          message: ERROR_MESSAGES.MATCH_MAP_ORDER_CONFLICT,
        });
      }
      const mapNames = maps.map((m) => m.mapName);
      if (new Set(mapNames).size !== mapNames.length) {
        return fail({
          code: ErrorCode.MATCH_MAP_DUPLICATE,
          message: ERROR_MESSAGES.MATCH_MAP_DUPLICATE,
        });
      }
    }

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
    });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);

    await db.transaction(async (tx) => {
      if (maps && maps.length > 0) {
        await tx.delete(matchMaps).where(eq(matchMaps.matchId, matchId));
        await tx.insert(matchMaps).values(
          maps.map((m) => ({
            matchId,
            mapOrder: m.mapOrder,
            mapName: m.mapName,
            pickedByTeamId: m.pickedByTeamId ?? null,
            teamAStartSide: m.teamAStartSide ?? null,
            scoreA: m.scoreA,
            scoreB: m.scoreB,
            completedAt: new Date(),
          }))
        );
      }

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

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.record_result",
        actorId: admin.adminId,
        targetId: matchId,
        targetType: "match",
        meta: { scoreA, scoreB, mapCount: maps?.length ?? 0 },
      });
    });

    revalidatePath(`/${season.slug}/matches/${matchId}`);
    revalidatePath(`/admin/${season.slug}/matches`);
    return ok({ matchId });
  } catch (e) {
    if (e instanceof AppError) {
      return fail({ code: e.code, message: e.message });
    }
    console.error("[recordMatchResult]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

export async function cancelMatch(
  matchId: string
): Promise<ActionResult<{ matchId: string }>> {
  try {
    const admin = await requireAdmin();

    const match = await db.query.matches.findFirst({
      where: eq(matches.id, matchId),
    });
    if (!match) {
      return fail({ code: ErrorCode.MATCH_NOT_FOUND, message: ERROR_MESSAGES.MATCH_NOT_FOUND });
    }
    if (match.status !== "scheduled") {
      return fail({
        code: ErrorCode.MATCH_INVALID_TRANSITION,
        message: "只有 scheduled 状态的比赛可以取消",
      });
    }

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
    });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);

    await db.transaction(async (tx) => {
      await tx
        .update(matches)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(matches.id, matchId));

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.cancel",
        actorId: admin.adminId,
        targetId: matchId,
        targetType: "match",
      });
    });

    revalidatePath(`/admin/${season.slug}/matches`);
    return ok({ matchId });
  } catch (e) {
    if (e instanceof AppError) {
      return fail({ code: e.code, message: e.message });
    }
    console.error("[cancelMatch]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}
