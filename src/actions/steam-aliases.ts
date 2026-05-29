"use server";

import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { userSteamAliases, users } from "@/db/schema";
import { demoPlayers, demoPlayerStats } from "@/db/schema/demo";
import { seasonRegistrations } from "@/db/schema/registrations";
import { ok, fail, type ActionResult } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import { requireSuperAdmin, requireSeasonAdmin } from "@/lib/auth/session";
import { sql } from "drizzle-orm";

export interface UnlinkedPlayer {
  steamId64: string;
  gameName: string;
  mapCount: number;
}

/** 查询当前赛季 demo 中未绑定到任何用户的选手 */
export async function getUnlinkedDemoPlayers(
  seasonId: string,
): Promise<ActionResult<UnlinkedPlayer[]>> {
  try {
    await requireSeasonAdmin(seasonId);
  } catch {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "需要管理员权限" });
  }

  try {
    const { rows } = await db.execute(sql`
      SELECT
        dp.steam_id64,
        MAX(dp.name) AS game_name,
        COUNT(DISTINCT dp.map_id)::int AS map_count
      FROM demo_players dp
      JOIN demo_imports di ON di.id = dp.import_batch_id
      JOIN match_maps mm ON mm.id = dp.map_id
      JOIN matches m ON m.id = mm.match_id
      WHERE m.season_id = ${seasonId}
        AND dp.user_id IS NULL
      GROUP BY dp.steam_id64
      ORDER BY map_count DESC
    `);
    return ok(
      (rows as { steam_id64: string; game_name: string; map_count: number }[]).map((r) => ({
        steamId64: r.steam_id64,
        gameName: r.game_name,
        mapCount: r.map_count,
      })),
    );
  } catch (e) {
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: String(e) });
  }
}

/** 绑定 steamId64 到 userId，并回填所有历史 demo 数据 */
export async function bindSteamAlias(
  steamId64: string,
  userId: string,
  note?: string,
): Promise<ActionResult<{ updatedRows: number }>> {
  try {
    await requireSuperAdmin();
  } catch {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "需要管理员权限" });
  }

  try {
    // 写入别名表
    await db
      .insert(userSteamAliases)
      .values({ steamId64, userId, note: note ?? null })
      .onConflictDoUpdate({
        target: userSteamAliases.steamId64,
        set: { userId, note: note ?? null },
      });

    // 回填 demo_players
    await db
      .update(demoPlayers)
      .set({ userId })
      .where(and(eq(demoPlayers.steamId64, steamId64), isNull(demoPlayers.userId)));

    // 回填 demo_player_stats
    await db
      .update(demoPlayerStats)
      .set({ userId })
      .where(and(eq(demoPlayerStats.steamId64, steamId64), isNull(demoPlayerStats.userId)));

    return ok({ updatedRows: 1 });
  } catch (e) {
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: String(e) });
  }
}

/** 解绑 steamId64 别名 */
export async function unbindSteamAlias(
  steamId64: string,
): Promise<ActionResult<void>> {
  try {
    await requireSuperAdmin();
  } catch {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "需要管理员权限" });
  }

  try {
    await db.delete(userSteamAliases).where(eq(userSteamAliases.steamId64, steamId64));
    return ok(undefined);
  } catch (e) {
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: String(e) });
  }
}

/** 查询当前赛季已注册选手列表（供绑定时下拉选择） */
export async function getSeasonRegisteredUsers(
  seasonId: string,
): Promise<ActionResult<{ userId: string; perfectName: string; steam64: string | null }[]>> {
  try {
    await requireSeasonAdmin(seasonId);
  } catch {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "需要管理员权限" });
  }

  try {
    const rows = await db
      .select({
        userId: users.id,
        perfectName: users.perfectName,
        steam64: users.steam64,
      })
      .from(users)
      .innerJoin(seasonRegistrations, eq(seasonRegistrations.userId, users.id))
      .where(eq(seasonRegistrations.seasonId, seasonId))
      .orderBy(users.perfectName);
    return ok(
      rows.map((r) => ({
        userId: r.userId,
        perfectName: r.perfectName ?? r.steam64 ?? r.userId,
        steam64: r.steam64,
      })),
    );
  } catch (e) {
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: String(e) });
  }
}
