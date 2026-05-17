"use server";

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { matchMaps } from "@/db/schema/match-maps";
import { matches } from "@/db/schema/matches";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { auditLogs } from "@/db/schema/audit";
import { users } from "@/db/schema/users";
import { seasonRegistrations } from "@/db/schema/registrations";
import { teamMembers } from "@/db/schema/teams";
import { ok, fail } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { MVP_DEADLINE_MS } from "@/lib/utils/date";
import { extractScoreboardFromBase64 } from "@/lib/ocr";
import type { PlayerRowOCR } from "@/lib/ocr";
import { requireAdmin, auditActorId, requireAuth } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";

export type PlayerStatsDraft = PlayerRowOCR & {
  userId: string | null;
};

export type PlayerOption = {
  userId: string;
  perfectName: string;
};

/**
 * 从截图 base64 提取记分板数据（不写库），返回草稿供管理员确认。
 * 同时返回赛季中所有已匹配玩家列表供下拉选择。
 */
export async function extractStatsFromScreenshot(
  input: {
    mapId: string;
    base64Image: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
  },
) {
  const { mapId, base64Image, mimeType } = input;
  try {
    await requireAdmin();

    const map = await db.query.matchMaps.findFirst({
      where: eq(matchMaps.id, mapId),
    });
    if (!map) throw new AppError(ErrorCode.NOT_FOUND, "地图记录不存在");

    const match = await db.query.matches.findFirst({
      where: eq(matches.id, map.matchId),
    });
    if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛记录不存在");

    // 仅查询本场比赛两队队员（用于昵称匹配 + 下拉选择）
    const teamMemberRows = await db
      .select({ registrationId: teamMembers.registrationId })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, [match.teamAId, match.teamBId]));

    const teamRegistrationIds = teamMemberRows.map((r) => r.registrationId);

    const seasonPlayers = teamRegistrationIds.length
      ? await db
          .select({
            userId: users.id,
            perfectName: users.perfectName,
          })
          .from(users)
          .innerJoin(seasonRegistrations, eq(seasonRegistrations.userId, users.id))
          .where(inArray(seasonRegistrations.id, teamRegistrationIds))
      : [];

    const nameToUserId = new Map<string, string>();
    for (const p of seasonPlayers) {
      if (p.perfectName) {
        nameToUserId.set(p.perfectName.toLowerCase(), p.userId);
      }
    }

    const ocrResult = await extractScoreboardFromBase64(base64Image, mimeType);

    const drafts: PlayerStatsDraft[] = ocrResult.players.map((row) => {
      const name = row.perfectName as string;
      return {
        ...row,
        perfectName: name,
        userId: nameToUserId.get(name.toLowerCase()) ?? null,
      };
    });

    const playerOptions: PlayerOption[] = seasonPlayers.map((p) => ({
      userId: p.userId,
      perfectName: p.perfectName ?? "(未填写昵称)",
    }));

    return ok({ drafts, playerOptions });
  } catch (e) {
    if (e instanceof AppError) {
      return fail({ code: e.code, message: e.message });
    }
    console.error("[extractStatsFromScreenshot]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: "OCR 识别失败，请检查截图格式后重试" });
  }
}

/**
 * 保存管理员确认后的玩家数据（幂等：先删同 mapId 旧数据，再批量插入）。
 */
export async function savePlayerStats(
  mapId: string,
  input: { rows: PlayerStatsDraft[] }
) {
  const stats = input.rows;
  try {
    const session = await requireAdmin();
    const actor = auditActorId(session);

    const map = await db.query.matchMaps.findFirst({
      where: eq(matchMaps.id, mapId),
    });
    if (!map) throw new AppError(ErrorCode.NOT_FOUND, "地图记录不存在");

    const match = await db.query.matches.findFirst({
      where: eq(matches.id, map.matchId),
    });
    if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛记录不存在");

    await db.transaction(async (tx) => {
      await tx.delete(matchPlayerStats).where(eq(matchPlayerStats.mapId, mapId));

      if (stats.length > 0) {
        await tx.insert(matchPlayerStats).values(
          stats.map((s) => ({
            matchId: map.matchId,
            mapId,
            perfectName: s.perfectName as string,
            userId: s.userId ?? undefined,
            kills: s.kills ?? undefined,
            deaths: s.deaths ?? undefined,
            assists: s.assists ?? undefined,
            hsPercent: s.hsPercent ?? undefined,
            firstKills: s.firstKills ?? undefined,
            multiKills: s.multiKills ?? undefined,
            clutches: s.clutches ?? undefined,
            adr: s.adr ?? undefined,
            rws: s.rws ?? undefined,
            ratingPro: s.ratingPro ?? undefined,
            we: s.we ?? undefined,
            verifiedByAdmin: actor,
            verifiedAt: new Date(),
          }))
        );
      }

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.save_player_stats",
        actorId: actor,
        targetId: mapId,
        targetType: "match_map",
        meta: { playerCount: stats.length, matchId: map.matchId },
      });
    });

    return ok({ saved: stats.length });
  } catch (e) {
    return actionError("savePlayerStats", e);
  }
}

/**
 * 查询某张地图已保存的玩家数据
 */
export async function getPlayerStatsByMap(mapId: string) {
  return db.query.matchPlayerStats.findMany({
    where: eq(matchPlayerStats.mapId, mapId),
    orderBy: (t, { desc }) => [desc(t.ratingPro)],
  });
}

/**
 * 获取某张地图对应比赛的两队选手列表（用于 OCR 编辑时的下拉匹配）
 */
export async function getMatchPlayerOptions(mapId: string): Promise<PlayerOption[]> {
  try {
    await requireAdmin();
    const map = await db.query.matchMaps.findFirst({ where: eq(matchMaps.id, mapId) });
    if (!map) return [];
    const match = await db.query.matches.findFirst({ where: eq(matches.id, map.matchId) });
    if (!match) return [];

    const teamMemberRows = await db
      .select({ registrationId: teamMembers.registrationId })
      .from(teamMembers)
      .where(inArray(teamMembers.teamId, [match.teamAId, match.teamBId]));

    const teamRegistrationIds = teamMemberRows.map((r) => r.registrationId);
    if (!teamRegistrationIds.length) return [];

    const seasonPlayers = await db
      .select({ userId: users.id, perfectName: users.perfectName })
      .from(users)
      .innerJoin(seasonRegistrations, eq(seasonRegistrations.userId, users.id))
      .where(inArray(seasonRegistrations.id, teamRegistrationIds));

    return seasonPlayers.map((p) => ({
      userId: p.userId,
      perfectName: p.perfectName ?? "(未填写昵称)",
    }));
  } catch {
    return [];
  }
}

export async function castMatchMvpVote(
  matchId: string,
  playerUserId: string | null,
  playerName: string,
) {
  try {
    const session = await requireAuth();
    if (!session?.userId) {
      return fail({ code: ErrorCode.UNAUTHORIZED, message: "请先登录" });
    }

    const match = await db.query.matches.findFirst({
      where: eq(matches.id, matchId),
    });
    if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, ERROR_MESSAGES.MATCH_NOT_FOUND);
    if (match.status !== "finished") {
      return fail({ code: ErrorCode.MATCH_INVALID_TRANSITION, message: "比赛尚未结束" });
    }

    // 比赛结束 24 小时后停止投票
    if (match.completedAt) {
      const deadline = match.completedAt.getTime() + MVP_DEADLINE_MS;
      if (Date.now() >= deadline) {
        return fail({ code: ErrorCode.MATCH_INVALID_TRANSITION, message: "MVP 投票已截止" });
      }
    }

    await db.insert(matchMvpVotes).values({
      matchId,
      playerUserId: playerUserId ?? undefined,
      playerName,
      voterUserId: session.userId,
    });

    revalidatePath(`/${match.seasonId}/matches/${matchId}`);
    return ok(undefined);
  } catch (e) {
    if (e instanceof AppError) return fail({ code: e.code, message: e.message });
    if (e instanceof Error && e.message.includes("uniq_voter_per_match")) {
      return fail({ code: ErrorCode.VOTE_DUPLICATE, message: "您已为本场比赛投过 MVP 票" });
    }
    console.error("[castMatchMvpVote]", e);
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
  }
}

/** 确定并持久化比赛 MVP 胜者。已锁定时直接返回；投票未截止则返回 null。幂等。 */
export async function ensureMvpWinner(matchId: string): Promise<string | null> {
  try {
    const match = await db.query.matches.findFirst({
      where: eq(matches.id, matchId),
      columns: { id: true, status: true, completedAt: true, mvpWinnerUserId: true },
    });
    if (!match || match.status !== "finished" || !match.completedAt) return null;
    if (match.mvpWinnerUserId) return match.mvpWinnerUserId;
    if (Date.now() < match.completedAt.getTime() + MVP_DEADLINE_MS) return null;

    const results = await getMatchMvpResults(matchId);
    if (results.length === 0) return null;
    const winner = results[0]; // 已按 count DESC 排

    await db
      .update(matches)
      .set({ mvpWinnerUserId: winner.playerUserId, updatedAt: new Date() })
      .where(eq(matches.id, matchId));

    return winner.playerUserId;
  } catch (e) {
    console.error("[ensureMvpWinner]", e);
    return null;
  }
}

export async function getMatchMvpResults(matchId: string) {
  const votes = await db
    .select({
      playerUserId: matchMvpVotes.playerUserId,
      playerName: matchMvpVotes.playerName,
      count: sql<number>`count(*)::int`,
    })
    .from(matchMvpVotes)
    .where(eq(matchMvpVotes.matchId, matchId))
    .groupBy(matchMvpVotes.playerUserId, matchMvpVotes.playerName)
    .orderBy((t) => desc(t.count));

  return votes;
}
