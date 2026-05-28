"use server";

import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { demoPlayers, demoPlayerStats, demoBlinds } from "@/db/schema/demo";
import { matchMaps } from "@/db/schema/match-maps";
import { matches, seasons } from "@/db/schema";
import { ok, fail, type ActionResult } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import { aggregatePlayerDemoStats } from "@/lib/demo/player-demo-stats";

/**
 * 获取选手在当前赛季的 demo 聚合统计。
 * 查询流程：userId → demoPlayers.steamId64 → demoPlayerStats → aggregate
 */
export async function getPlayerDemoStats(
  userId: string,
  seasonSlug: string,
): Promise<ActionResult<ReturnType<typeof aggregatePlayerDemoStats>>> {
  // 1. 找当前赛季
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
    columns: { id: true },
  });
  if (!season) {
    return fail({ code: ErrorCode.SEASON_NOT_FOUND, message: "赛季不存在" });
  }

  // 2. 找该 userId 在当前赛季 map 中参与的所有 demo 行（通过 matches 关联 season）
  const mapRows = await db
    .select({ mapId: matchMaps.id })
    .from(matchMaps)
    .innerJoin(matches, eq(matchMaps.matchId, matches.id))
    .innerJoin(seasons, eq(matches.seasonId, seasons.id))
    .where(eq(seasons.slug, seasonSlug));
  const mapIds = mapRows.map((r) => r.mapId);
  if (mapIds.length === 0) {
    return ok(aggregatePlayerDemoStats([]));
  }

  // 3. 查该 userId 的 steamId64 列表
  const playerRows = await db
    .select({ steamId64: demoPlayers.steamId64 })
    .from(demoPlayers)
    .where(
      and(
        eq(demoPlayers.userId, userId),
        inArray(demoPlayers.mapId, mapIds),
      ),
    );
  const steamIds = [...new Set(playerRows.map((r) => r.steamId64))];
  if (steamIds.length === 0) {
    return ok(aggregatePlayerDemoStats([]));
  }

  // 4. 取该 steamId64 在当前赛季所有 demo 中的 playerStats
  const statsRows = await db
    .select()
    .from(demoPlayerStats)
    .where(
      and(
        inArray(demoPlayerStats.steamId64, steamIds),
        inArray(demoPlayerStats.mapId, mapIds),
      ),
    );

  // 5. 取致盲数据（该选手作为 flasher 的 flash）
  const blindsRows = await db
    .select()
    .from(demoBlinds)
    .where(
      and(
        inArray(demoBlinds.flasherSteamId64, steamIds),
        inArray(demoBlinds.mapId, mapIds),
      ),
    );

  // 6. 聚合
  const stats = statsRows.map((r) => ({
    kills: r.kills ?? 0,
    deaths: r.deaths ?? 0,
    assists: r.assists ?? 0,
    adr: r.adr ?? 0,
    kast: r.kast ?? 0,
    firstKillCount: r.firstKillCount ?? 0,
    firstDeathCount: r.firstDeathCount ?? 0,
    tradeKillCount: r.tradeKillCount ?? 0,
    tradeDeathCount: r.tradeDeathCount ?? 0,
    oneKillCount: r.oneKillCount ?? 0,
    twoKillCount: r.twoKillCount ?? 0,
    threeKillCount: r.threeKillCount ?? 0,
    fourKillCount: r.fourKillCount ?? 0,
    fiveKillCount: r.fiveKillCount ?? 0,
    vsOneCount: r.vsOneCount ?? 0,
    vsOneWonCount: r.vsOneWonCount ?? 0,
    vsTwoCount: r.vsTwoCount ?? 0,
    vsTwoWonCount: r.vsTwoWonCount ?? 0,
    vsThreeCount: r.vsThreeCount ?? 0,
    vsThreeWonCount: r.vsThreeWonCount ?? 0,
    vsFourCount: r.vsFourCount ?? 0,
    vsFourWonCount: r.vsFourWonCount ?? 0,
    vsFiveCount: r.vsFiveCount ?? 0,
    vsFiveWonCount: r.vsFiveWonCount ?? 0,
    utilityDamage: r.utilityDamage ?? 0,
    averageUtilityDamagePerRound: r.averageUtilityDamagePerRound ?? 0,
    wallbangKillCount: r.wallbangKillCount ?? 0,
    noScopeKillCount: r.noScopeKillCount ?? 0,
    collateralKillCount: r.collateralKillCount ?? 0,
  }));

  const result = aggregatePlayerDemoStats(stats, blindsRows.map((b) => ({
    flasherSteamId64: b.flasherSteamId64 ?? "",
    flashedSide: b.flashedSide,
    flasherSide: b.flasherSide,
    durationSeconds: b.durationSeconds ?? 0,
  })));

  return ok(result);
}
