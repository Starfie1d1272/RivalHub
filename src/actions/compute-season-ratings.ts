"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, and, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  seasons,
  matches,
  matchMaps,
  demoImports,
  demoPlayerStats,
  demoBlinds,
  demoKills,
  demoGrenades,
  demoPlayerEconomies,
  auditLogs,
  playerRatings,
  users,
} from "@/db/schema";
import { ok, fail } from "@/types/action";
import type { ActionResult } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { toRRIndicators } from "@/lib/demo/to-rr-indicators";
import type { PlayerStatRow, BlindsRow } from "@/lib/demo/player-demo-stats";
import { computeRR, computeLeagueMean } from "@/lib/rating/rr/compute";
import { computePrism, rrToPercentile } from "@/lib/rating/prism/compute";
import type { PrismComputeInput } from "@/lib/rating/prism/compute";
import type { RRWeights } from "@/lib/rating/types/rr";
import type { PrismWeights } from "@/lib/rating/types/prism";
import rrWeightsRaw from "@/lib/rating/weights/rr-v1.json";
import prismWeightsRaw from "@/lib/rating/weights/prism-v1.json";

export async function recomputeSeasonRatings(
  seasonId: string,
): Promise<ActionResult<{ playerCount: number; weightsVersion: string }>> {
  try {
    const admin = await requireSeasonAdmin(seasonId);

    // ── 1. 查出该赛季所有 matchMap id ─────────────────────────────────────
    const seasonMatches = await db.query.matches.findMany({
      where: eq(matches.seasonId, seasonId),
      columns: { id: true },
    });
    if (seasonMatches.length === 0) {
      return fail({ code: ErrorCode.NOT_FOUND, message: "该赛季暂无比赛数据" });
    }

    const matchIds = seasonMatches.map((m) => m.id);
    const allMaps = await db.query.matchMaps.findMany({
      where: inArray(matchMaps.matchId, matchIds),
      columns: { id: true },
    });
    if (allMaps.length === 0) {
      return fail({ code: ErrorCode.NOT_FOUND, message: "该赛季暂无地图数据" });
    }

    const mapIds = allMaps.map((m) => m.id);

    // ── 2. 查出这些地图对应的 importBatchId ───────────────────────────────
    const imports = await db.query.demoImports.findMany({
      where: inArray(demoImports.mapId, mapIds),
      columns: { id: true, mapId: true },
    });
    if (imports.length === 0) {
      return fail({ code: ErrorCode.NOT_FOUND, message: "该赛季暂无已导入的 demo" });
    }

    const importIds = imports.map((i) => i.id);

    // ── 3. 批量查出所有 demo 数据 ──────────────────────────────────────────
    const [allStats, allBlinds, allKills, allGrenades, allEconomies] =
      await Promise.all([
        db.query.demoPlayerStats.findMany({
          where: inArray(demoPlayerStats.importBatchId, importIds),
        }),
        db.query.demoBlinds.findMany({
          where: inArray(demoBlinds.importBatchId, importIds),
        }),
        db.query.demoKills.findMany({
          where: and(
            inArray(demoKills.importBatchId, importIds),
            eq(demoKills.flashAssist, true),
          ),
        }),
        db.query.demoGrenades.findMany({
          where: inArray(demoGrenades.importBatchId, importIds),
        }),
        db.query.demoPlayerEconomies.findMany({
          where: inArray(demoPlayerEconomies.importBatchId, importIds),
        }),
      ]);

    // ── 4. 按 steamId64 做初步分组 ───────────────────────────────────────
    // stats
    const statsBySteam = new Map<string, PlayerStatRow[]>();
    for (const s of allStats) {
      const arr = statsBySteam.get(s.steamId64) ?? [];
      arr.push(s as PlayerStatRow);
      statsBySteam.set(s.steamId64, arr);
    }

    // blinds（flasher 维度）
    const blindsBySteam = new Map<string, BlindsRow[]>();
    for (const b of allBlinds) {
      if (!b.flasherSteamId64) continue;
      const arr = blindsBySteam.get(b.flasherSteamId64) ?? [];
      arr.push(b as BlindsRow);
      blindsBySteam.set(b.flasherSteamId64, arr);
    }

    // flashAssistCount（killerSteamId64，flashAssist=true 已在查询中过滤）
    const flashAssistBySteam = new Map<string, number>();
    for (const k of allKills) {
      if (!k.killerSteamId64) continue;
      flashAssistBySteam.set(
        k.killerSteamId64,
        (flashAssistBySteam.get(k.killerSteamId64) ?? 0) + 1,
      );
    }

    // grenadeCount
    const grenadeBySteam = new Map<string, number>();
    for (const g of allGrenades) {
      if (!g.throwerSteamId64) continue;
      grenadeBySteam.set(
        g.throwerSteamId64,
        (grenadeBySteam.get(g.throwerSteamId64) ?? 0) + 1,
      );
    }

    // economy per steam
    type EcoAgg = {
      ecoRounds: number;
      forceRounds: number;
      fullBuyRounds: number;
      pistolRounds: number;
      equipmentValueSum: number;
      equipmentValueCount: number;
    };
    const ecoBySteam = new Map<string, EcoAgg>();
    for (const e of allEconomies) {
      const key = e.steamId64;
      const agg = ecoBySteam.get(key) ?? {
        ecoRounds: 0,
        forceRounds: 0,
        fullBuyRounds: 0,
        pistolRounds: 0,
        equipmentValueSum: 0,
        equipmentValueCount: 0,
      };
      const t = (e.type ?? "").toLowerCase();
      if (t === "eco") agg.ecoRounds++;
      else if (t === "force") agg.forceRounds++;
      else if (t === "full_buy" || t === "fullbuy") agg.fullBuyRounds++;
      else if (t === "pistol") agg.pistolRounds++;
      if (e.equipmentValue != null) {
        agg.equipmentValueSum += e.equipmentValue;
        agg.equipmentValueCount++;
      }
      ecoBySteam.set(key, agg);
    }

    // mapCount per steam
    const mapCountBySteam = new Map<string, Set<string>>();
    for (const s of allStats) {
      const set = mapCountBySteam.get(s.steamId64) ?? new Set();
      set.add(s.mapId);
      mapCountBySteam.set(s.steamId64, set);
    }

    // ── 5. 构建 steamId64 → userId 映射 ──────────────────────────────────
    //   优先从 demo_player_stats.user_id（导入时已解析，含多 steamId64
    //   指向同一 user 的情况）；再从 users.steam64 补充。
    const steamId64ToUserId = new Map<string, string | null>();
    // 来源1: demo_player_stats.user_id（最权威 — 含改名/换号关联）
    for (const s of allStats) {
      if (!steamId64ToUserId.has(s.steamId64) && s.userId) {
        steamId64ToUserId.set(s.steamId64, s.userId);
      }
    }
    // 收集所有出现的 steamId64
    const allSteamSet = new Set<string>();
    for (const s of allStats) allSteamSet.add(s.steamId64);
    for (const b of allBlinds) { if (b.flasherSteamId64) allSteamSet.add(b.flasherSteamId64); }
    for (const k of allKills) { if (k.killerSteamId64) allSteamSet.add(k.killerSteamId64); }
    for (const g of allGrenades) { if (g.throwerSteamId64) allSteamSet.add(g.throwerSteamId64); }
    for (const e of allEconomies) allSteamSet.add(e.steamId64);
    // 来源2: users 表（补充 demo 数据里没有 userId 的 steam）
    const userRows = allSteamSet.size > 0
      ? await db.query.users.findMany({
          where: inArray(users.steam64, [...allSteamSet]),
          columns: { id: true, steam64: true },
        })
      : [];
    for (const u of userRows) {
      if (u.steam64 && !steamId64ToUserId.has(u.steam64)) {
        steamId64ToUserId.set(u.steam64, u.id);
      }
    }

    // ── 6. 定义 player key：优先 userId，无 userId 时用 steamId64 ───────
    const getPlayerKey = (steam: string): string =>
      steamId64ToUserId.get(steam) ?? steam;

    // steamId64 按 playerKey 归并
    const steamsByPlayerKey = new Map<string, Set<string>>();
    for (const steam of allSteamSet) {
      const pk = getPlayerKey(steam);
      const set = steamsByPlayerKey.get(pk) ?? new Set();
      set.add(steam);
      steamsByPlayerKey.set(pk, set);
    }

    // 为每个 playerKey 选一个 primary steamId64：
    //   优先选 users.steam64 里的，否则选数据最多的那个
    const primarySteam = new Map<string, string>();
    for (const [pk, steamSet] of steamsByPlayerKey) {
      const usersSteam = [...steamSet].find((s) =>
        userRows.some((u) => u.steam64 === s),
      );
      if (usersSteam) {
        primarySteam.set(pk, usersSteam);
      } else {
        // 选 stats 行数最多的 steamId64
        let best = [...steamSet][0];
        let bestCount = 0;
        for (const s of steamSet) {
          const c = statsBySteam.get(s)?.length ?? 0;
          if (c > bestCount) { best = s; bestCount = c; }
        }
        primarySteam.set(pk, best);
      }
    }

    // ── 7. 按 playerKey 合并数据 ─────────────────────────────────────────
    const playerKeys = [...steamsByPlayerKey.keys()];

    const mergeStats = (pk: string): PlayerStatRow[] => {
      const result: PlayerStatRow[] = [];
      for (const steam of steamsByPlayerKey.get(pk) ?? []) {
        result.push(...(statsBySteam.get(steam) ?? []));
      }
      return result;
    };
    const mergeBlinds = (pk: string): BlindsRow[] => {
      const result: BlindsRow[] = [];
      for (const steam of steamsByPlayerKey.get(pk) ?? []) {
        result.push(...(blindsBySteam.get(steam) ?? []));
      }
      return result;
    };
    const mergeSum = (pk: string, map: Map<string, number>): number => {
      let sum = 0;
      for (const steam of steamsByPlayerKey.get(pk) ?? []) {
        sum += map.get(steam) ?? 0;
      }
      return sum;
    };
    const mergeEco = (pk: string): EcoAgg | undefined => {
      const merged: EcoAgg = {
        ecoRounds: 0, forceRounds: 0, fullBuyRounds: 0, pistolRounds: 0,
        equipmentValueSum: 0, equipmentValueCount: 0,
      };
      let hasData = false;
      for (const steam of steamsByPlayerKey.get(pk) ?? []) {
        const agg = ecoBySteam.get(steam);
        if (!agg) continue;
        hasData = true;
        merged.ecoRounds += agg.ecoRounds;
        merged.forceRounds += agg.forceRounds;
        merged.fullBuyRounds += agg.fullBuyRounds;
        merged.pistolRounds += agg.pistolRounds;
        merged.equipmentValueSum += agg.equipmentValueSum;
        merged.equipmentValueCount += agg.equipmentValueCount;
      }
      return hasData ? merged : undefined;
    };
    const mergeMapCount = (pk: string): Set<string> => {
      const set = new Set<string>();
      for (const steam of steamsByPlayerKey.get(pk) ?? []) {
        for (const mapId of mapCountBySteam.get(steam) ?? []) {
          set.add(mapId);
        }
      }
      return set;
    };

    // ── 8. 计算每人的 RRIndicators 并调用 computeRR ───────────────────────
    const rrWeights = rrWeightsRaw as unknown as RRWeights;
    const prismWeights = prismWeightsRaw as unknown as PrismWeights;

    const mergedData = playerKeys.map((pk) => {
      const stats = mergeStats(pk);
      const ecoAgg = mergeEco(pk);
      const economy = ecoAgg
        ? {
            ecoRounds: ecoAgg.ecoRounds,
            forceRounds: ecoAgg.forceRounds,
            fullBuyRounds: ecoAgg.fullBuyRounds,
            pistolRounds: ecoAgg.pistolRounds,
            avgEquipmentValue:
              ecoAgg.equipmentValueCount > 0
                ? ecoAgg.equipmentValueSum / ecoAgg.equipmentValueCount
                : 0,
          }
        : undefined;

      // userId: 若 pk 本身就是 userId 则直接用，否则查 steam→user 映射
      const isUserId = [...steamId64ToUserId.values()].some((uid) => uid === pk);
      const uid = isUserId ? pk : (steamId64ToUserId.get(pk) ?? null);

      return {
        playerKey: pk,
        primarySteamId64: primarySteam.get(pk)!,
        userId: uid,
        indicators: toRRIndicators({
          steamId64: primarySteam.get(pk)!,
          stats,
          blinds: mergeBlinds(pk),
          flashAssistCount: mergeSum(pk, flashAssistBySteam),
          grenadeCount: mergeSum(pk, grenadeBySteam),
          economy,
        }),
        mapCountSet: mergeMapCount(pk),
      };
    });

    const indicatorsList = mergedData.map((d) => d.indicators);
    const rrResults = indicatorsList.map((ind) => computeRR(ind, rrWeights));

    // ── 9. 锚定到联赛均值 ─────────────────────────────────────────────────
    const leagueMean = computeLeagueMean(rrResults);
    const anchoredRR = rrResults.map((r) => ({
      ...r,
      rr: leagueMean > 0 ? r.rr / leagueMean : r.rr,
    }));

    // ── 10. 构建 PRISM cohort 并计算 ─────────────────────────────────────
    const allAnchored = anchoredRR.map((r) => r.rr);
    const cohort: PrismComputeInput[] = indicatorsList.map((ind, i) => ({
      indicators: ind,
      mapCount: mergedData[i]?.mapCountSet.size ?? 1,
      rrPercentile: rrToPercentile(allAnchored, anchoredRR[i]?.rr ?? 1),
    }));

    const prismResults = computePrism(cohort, prismWeights);

    // ── 11. Upsert player_ratings ─────────────────────────────────────────
    const now = new Date();
    const upsertRows = mergedData.map((d, i) => {
      const rr = anchoredRR[i];
      const prism = prismResults[i];
      const mc = d.mapCountSet.size;

      return {
        seasonId,
        userId: d.userId,
        steamId64: d.primarySteamId64,
        rrScore: rr ? String(rr.rr.toFixed(4)) : null,
        rrWeightsVersion: rrWeights.version,
        prismFirepower: prism ? String(prism.axes.firepower.percentile.toFixed(2)) : null,
        prismOpening:   prism ? String(prism.axes.opening.percentile.toFixed(2))   : null,
        prismClutch:    prism ? String(prism.axes.clutch.percentile.toFixed(2))     : null,
        prismSniping:   prism ? String(prism.axes.sniping.percentile.toFixed(2))    : null,
        prismSurvival:  prism ? String(prism.axes.survival.percentile.toFixed(2))   : null,
        prismUtility:   prism ? String(prism.axes.utility.percentile.toFixed(2))    : null,
        prismTrading:   prism ? String(prism.axes.trading.percentile.toFixed(2))    : null,
        prismEntry:     prism ? String(prism.axes.entry.percentile.toFixed(2))      : null,
        prismWeightsVersion: prismWeights.version,
        mapCount: mc,
        computedAt: now,
      };
    });

    if (upsertRows.length > 0) {
      await db
        .insert(playerRatings)
        .values(upsertRows)
        .onConflictDoUpdate({
          target: [playerRatings.seasonId, playerRatings.steamId64],
          set: {
            userId:              sql`excluded.user_id`,
            rrScore:             sql`excluded.rr_score`,
            rrWeightsVersion:    sql`excluded.rr_weights_version`,
            prismFirepower:      sql`excluded.prism_firepower`,
            prismOpening:        sql`excluded.prism_opening`,
            prismClutch:         sql`excluded.prism_clutch`,
            prismSniping:        sql`excluded.prism_sniping`,
            prismSurvival:       sql`excluded.prism_survival`,
            prismUtility:        sql`excluded.prism_utility`,
            prismTrading:        sql`excluded.prism_trading`,
            prismEntry:          sql`excluded.prism_entry`,
            prismWeightsVersion: sql`excluded.prism_weights_version`,
            mapCount:            sql`excluded.map_count`,
            computedAt:          sql`excluded.computed_at`,
          },
        });
    }

    // ── 清理合并后冗余的 player_ratings 行 ────────────────────────────────
    // 删除那些 steamId64 属于同 userId 但不再是 primary 的旧行
    const allPrimarySteams = new Set(mergedData.map((d) => d.primarySteamId64));
    const staleSteams = [...allSteamSet].filter(
      (s) => !allPrimarySteams.has(s) && getPlayerKey(s) !== s,
    );
    if (staleSteams.length > 0) {
      await db
        .delete(playerRatings)
        .where(
          and(
            eq(playerRatings.seasonId, seasonId),
            inArray(playerRatings.steamId64, staleSteams),
          ),
        );
    }

    // ── 12. 写 audit_log ──────────────────────────────────────────────────
    await db.insert(auditLogs).values({
      seasonId,
      action: "season.recompute_ratings",
      actorId: auditActorId(admin),
      targetId: seasonId,
      targetType: "season",
      meta: {
        playerCount: mergedData.length,
        rrWeightsVersion: rrWeights.version,
        prismWeightsVersion: prismWeights.version,
      },
    });

    // ── 13. 重新验证缓存 ──────────────────────────────────────────────────
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
      columns: { slug: true },
    });
    if (season) {
      revalidatePath(`/${season.slug}`);
      revalidatePath(`/admin/${season.slug}/demos`);
    }

    return ok({ playerCount: mergedData.length, weightsVersion: rrWeights.version });
  } catch (e) {
    return actionError("recomputeSeasonRatings", e);
  }
}
