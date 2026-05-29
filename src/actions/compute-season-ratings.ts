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

    // ── 4. 按 steamId64 分组 ──────────────────────────────────────────────
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

    // mapCount per steam（该选手出现在多少张不同地图中）
    const mapCountBySteam = new Map<string, Set<string>>();
    for (const s of allStats) {
      const set = mapCountBySteam.get(s.steamId64) ?? new Set();
      set.add(s.mapId);
      mapCountBySteam.set(s.steamId64, set);
    }

    // ── 5. 查 userId 映射（steam64 → userId）─────────────────────────────
    const steamList = [...statsBySteam.keys()];
    const userRows = steamList.length > 0
      ? await db.query.users.findMany({
          where: inArray(users.steam64, steamList),
          columns: { id: true, steam64: true },
        })
      : [];
    const userIdBySteam = new Map(
      userRows.filter((u) => u.steam64).map((u) => [u.steam64!, u.id]),
    );

    // ── 6. 计算每人的 RRIndicators 并调用 computeRR ───────────────────────
    const rrWeights = rrWeightsRaw as unknown as RRWeights;
    const prismWeights = prismWeightsRaw as unknown as PrismWeights;

    const indicatorsList = steamList.map((steamId64) => {
      const stats = statsBySteam.get(steamId64) ?? [];
      const blinds = blindsBySteam.get(steamId64) ?? [];
      const ecoAgg = ecoBySteam.get(steamId64);
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

      return toRRIndicators({
        steamId64,
        stats,
        blinds,
        flashAssistCount: flashAssistBySteam.get(steamId64) ?? 0,
        grenadeCount: grenadeBySteam.get(steamId64) ?? 0,
        economy,
      });
    });

    const rrResults = indicatorsList.map((ind) => computeRR(ind, rrWeights));

    // ── 7. 锚定到联赛均值 ─────────────────────────────────────────────────
    const leagueMean = computeLeagueMean(rrResults);
    const anchoredRR = rrResults.map((r) => ({
      ...r,
      rr: leagueMean > 0 ? r.rr / leagueMean : r.rr,
    }));

    // ── 8. 构建 PRISM cohort 并计算 ──────────────────────────────────────
    const allAnchored = anchoredRR.map((r) => r.rr);
    const cohort: PrismComputeInput[] = indicatorsList.map((ind, i) => ({
      indicators: ind,
      mapCount: mapCountBySteam.get(ind.steamId64)?.size ?? 1,
      rrPercentile: rrToPercentile(allAnchored, anchoredRR[i]?.rr ?? 1),
    }));

    const prismResults = computePrism(cohort, prismWeights);

    // ── 9. Upsert player_ratings ──────────────────────────────────────────
    const now = new Date();
    const upsertRows = steamList.map((steamId64, i) => {
      const rr = anchoredRR[i];
      const prism = prismResults[i];
      const mc = mapCountBySteam.get(steamId64)?.size ?? 0;

      return {
        seasonId,
        userId: userIdBySteam.get(steamId64) ?? null,
        steamId64,
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

    // ── 10. 写 audit_log ──────────────────────────────────────────────────
    await db.insert(auditLogs).values({
      seasonId,
      action: "season.recompute_ratings",
      actorId: auditActorId(admin),
      targetId: seasonId,
      targetType: "season",
      meta: {
        playerCount: steamList.length,
        rrWeightsVersion: rrWeights.version,
        prismWeightsVersion: prismWeights.version,
      },
    });

    // ── 11. 重新验证缓存 ──────────────────────────────────────────────────
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
      columns: { slug: true },
    });
    if (season) {
      revalidatePath(`/${season.slug}`);
      revalidatePath(`/admin/${season.slug}/demos`);
    }

    return ok({ playerCount: steamList.length, weightsVersion: rrWeights.version });
  } catch (e) {
    return actionError("recomputeSeasonRatings", e);
  }
}
