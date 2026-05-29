import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema/matches";
import { matchMaps } from "@/db/schema/match-maps";
import { ok, type ActionResult } from "@/types/action";
import { demoImports, demoPlayerStats, demoPlayers, demoKills } from "@/db/schema/demo";

export interface DemoLeaderboardData {
  userId: string | null;
  perfectName: string;
  steamId64: string | null;
  maps: number;
  kast: number | null;
  adr: number | null;
  firstKillCount: number;
  firstDeathCount: number;
  entrySuccessRate: number | null;
  clutchWinRate: number | null;
  clutchAttempts: number;
  avgUtilityDamagePerRound: number | null;
  /** FKPR（首杀/总回合） */
  fkpr: number;
}

export interface WeaponKillRow {
  weapon: string;
  kills: number;
  headshots: number;
  hsPercent: number | null;
}

export interface PlayerWeaponStats {
  userId: string | null;
  perfectName: string;
  steamId64: string | null;
  totalKills: number;
  awpKills: number;
  weapons: WeaponKillRow[];
}

/**
 * 聚合赛季内所有 active_stat_source='demo_import' 的 demo 数据，
 * 按 userId 汇总 KAST、ADR、首杀、残局胜率、utility/round。
 * 
 * 关联路径：demoImports.mapId → matchMaps.id → matchMaps.matchId → matches.id → matches.seasonId
 */
export async function getSeasonDemoStats(
  seasonId: string,
): Promise<ActionResult<DemoLeaderboardData[]>> {
  const { rows } = await db.execute(sql`
    SELECT
      dps.user_id,
      COALESCE(dp.name, 'Unknown') AS perfect_name,
      dp.steam_id64,
      count(*)::int AS maps,
      CASE WHEN count(*) > 0 THEN round(avg(dps.kast)::numeric, 4) ELSE NULL END AS kast,
      CASE WHEN count(*) > 0 THEN round(avg(dps.adr)::numeric, 1) ELSE NULL END AS adr,
      sum(dps.first_kill_count)::int AS first_kill_count,
      sum(dps.first_death_count)::int AS first_death_count,
      sum(dps.vs_one_count)::int AS vs1_count,
      sum(dps.vs_one_won_count)::int AS vs1_won,
      sum(dps.vs_two_count)::int AS vs2_count,
      sum(dps.vs_two_won_count)::int AS vs2_won,
      sum(dps.vs_three_count)::int AS vs3_count,
      sum(dps.vs_three_won_count)::int AS vs3_won,
      sum(dps.vs_four_count)::int AS vs4_count,
      sum(dps.vs_four_won_count)::int AS vs4_won,
      sum(dps.vs_five_count)::int AS vs5_count,
      sum(dps.vs_five_won_count)::int AS vs5_won,
      round(avg(dps.avg_utility_damage_per_round)::numeric, 1) AS avg_utility_damage_per_round,
      sum(rc.round_count)::int AS total_rounds
    FROM ${demoPlayerStats} dps
    JOIN ${demoImports} di ON di.id = dps.import_batch_id
    JOIN ${matchMaps} mm ON mm.id = di.map_id
    JOIN ${matches} m ON m.id = mm.match_id
    JOIN (
      SELECT import_batch_id, count(*)::int AS round_count
      FROM demo_rounds
      GROUP BY import_batch_id
    ) rc ON rc.import_batch_id = di.id
    LEFT JOIN ${demoPlayers} dp
      ON dp.steam_id64 = dps.steam_id64 AND dp.import_batch_id = dps.import_batch_id
    WHERE m.season_id = ${seasonId}
      AND mm.active_stat_source = 'demo_import'::stat_source
    GROUP BY dps.user_id, dp.name, dp.steam_id64
    ORDER BY kast DESC NULLS LAST
    LIMIT 100
  `);

  const data = (rows as unknown as any[]).map((r: any) => {
    const fk = Number(r.first_kill_count ?? 0);
    const fd = Number(r.first_death_count ?? 0);
    const vs1Count = Number(r.vs1_count ?? 0);
    const vs1Won = Number(r.vs1_won ?? 0);
    const vs2Count = Number(r.vs2_count ?? 0);
    const vs2Won = Number(r.vs2_won ?? 0);
    const vs3Count = Number(r.vs3_count ?? 0);
    const vs3Won = Number(r.vs3_won ?? 0);
    const vs4Count = Number(r.vs4_count ?? 0);
    const vs4Won = Number(r.vs4_won ?? 0);
    const vs5Count = Number(r.vs5_count ?? 0);
    const vs5Won = Number(r.vs5_won ?? 0);
    const totalClutchAttempts = vs1Count + vs2Count + vs3Count + vs4Count + vs5Count;
    const totalClutchWon = vs1Won + vs2Won + vs3Won + vs4Won + vs5Won;
    const totalRounds = Math.max(1, Number(r.total_rounds ?? 0));

    return {
      userId: r.user_id as string | null,
      perfectName: (r.perfect_name as string) ?? "Unknown",
      steamId64: r.steam_id64 as string | null,
      maps: Number(r.maps ?? 0),
      kast: r.kast != null ? Number(r.kast) : null,
      adr: r.adr != null ? Number(r.adr) : null,
      firstKillCount: fk,
      firstDeathCount: fd,
      entrySuccessRate: fk + fd > 0 ? Math.round((fk / (fk + fd)) * 10000) / 10000 : null,
      clutchAttempts: totalClutchAttempts,
      clutchWinRate: totalClutchAttempts > 0
        ? Math.round((totalClutchWon / totalClutchAttempts) * 10000) / 10000
        : null,
      avgUtilityDamagePerRound: r.avg_utility_damage_per_round != null
        ? Number(r.avg_utility_damage_per_round)
        : null,
      fkpr: fk / totalRounds,
    };
  });

  return ok(data);
}

/**
 * 按武器统计赛季内 demo 击杀数据。
 * 返回每个玩家每种武器的击杀数/爆头数/爆头率，以及 AWP 专用击杀数。
 */
export async function getSeasonWeaponStats(
  seasonId: string,
): Promise<ActionResult<PlayerWeaponStats[]>> {
  const { rows } = await db.execute(sql`
    SELECT
      dps.user_id,
      COALESCE(dp.name, 'Unknown') AS perfect_name,
      dp.steam_id64,
      dk.weapon,
      count(*)::int AS kills,
      sum(CASE WHEN dk.headshot THEN 1 ELSE 0 END)::int AS headshots
    FROM ${demoKills} dk
    JOIN ${demoImports} di ON di.id = dk.import_batch_id
    JOIN ${matchMaps} mm ON mm.id = dk.map_id
    JOIN ${matches} m ON m.id = mm.match_id
    LEFT JOIN ${demoPlayerStats} dps
      ON dps.import_batch_id = dk.import_batch_id AND dps.steam_id64 = dk.killer_steam_id64
    LEFT JOIN ${demoPlayers} dp
      ON dp.steam_id64 = dk.killer_steam_id64 AND dp.import_batch_id = dk.import_batch_id
    WHERE m.season_id = ${seasonId}
      AND mm.active_stat_source = 'demo_import'::stat_source
      AND dk.weapon IS NOT NULL
    GROUP BY dps.user_id, dp.name, dp.steam_id64, dk.weapon
    ORDER BY kills DESC
    LIMIT 500
  `);

  // 按 userId 分组
  const playerMap = new Map<string, PlayerWeaponStats>();

  for (const r of rows as any[]) {
    const uid = (r.user_id as string) ?? `steam_${r.steam_id64}`;
    if (!playerMap.has(uid)) {
      playerMap.set(uid, {
        userId: r.user_id as string | null,
        perfectName: (r.perfect_name as string) ?? "Unknown",
        steamId64: r.steam_id64 as string | null,
        totalKills: 0,
        awpKills: 0,
        weapons: [],
      });
    }
    const p = playerMap.get(uid)!;
    const weapon = r.weapon as string;
    const kills = Number(r.kills ?? 0);
    const headshots = Number(r.headshots ?? 0);
    p.totalKills += kills;
    if (weapon.toLowerCase() === "awp") {
      p.awpKills += kills;
    }
    p.weapons.push({
      weapon,
      kills,
      headshots,
      hsPercent: kills > 0 ? Math.round((headshots / kills) * 100) : null,
    });
  }

  const data = Array.from(playerMap.values())
    .sort((a, b) => b.awpKills - a.awpKills);

  return ok(data);
}


export interface WeaponKillStatsRow {
  userId: string | null;
  perfectName: string;
  weapon: string;
  kills: number;
  headshotPct: number | null;
  tradeKillPct: number | null;
  noScopePct: number | null;
  avgPenetrated: number | null;
}

/**
 * 赛季武器击杀榜：按 userId+weapon 汇总，含HS%/trade%/noScope%/穿墙数
 * 只统计 demo_kills（由 matchMaps.activeStatSource='demo_import' 过滤）
 */
export async function getWeaponKillStats(seasonId: string): Promise<WeaponKillStatsRow[]> {
  const { rows } = await db.execute(sql`
    SELECT
      dp.user_id,
      dp.name AS perfect_name,
      dk.weapon,
      count(*)::int AS kills,
      round(avg((dk.headshot IS TRUE)::int)::numeric, 3) AS headshot_pct,
      round(avg((dk.trade_kill IS TRUE)::int)::numeric, 3) AS trade_kill_pct,
      round(avg((dk.no_scope IS TRUE)::int)::numeric, 3) AS no_scope_pct,
      round(avg(coalesce(dk.penetrated_objects, 0))::numeric, 2) AS avg_penetrated
    FROM ${demoKills} dk
    JOIN ${matchMaps} mm ON mm.id = dk.map_id
    JOIN ${matches} m ON m.id = mm.match_id
    LEFT JOIN ${demoPlayers} dp ON dp.steam_id64 = dk.killer_steam_id64 AND dp.import_batch_id = dk.import_batch_id
    WHERE m.season_id = ${seasonId}
      AND mm.active_stat_source = 'demo_import'::stat_source
    GROUP BY dp.user_id, dp.name, dk.weapon
    HAVING count(*) >= 3
    ORDER BY kills DESC
    LIMIT 200
  `);

  return (rows as unknown as any[]).map((r: any) => ({
    userId: r.user_id as string | null,
    perfectName: r.perfect_name as string,
    weapon: r.weapon as string,
    kills: Number(r.kills),
    headshotPct: r.headshot_pct != null ? Number(r.headshot_pct) : null,
    tradeKillPct: r.trade_kill_pct != null ? Number(r.trade_kill_pct) : null,
    noScopePct: r.no_scope_pct != null ? Number(r.no_scope_pct) : null,
    avgPenetrated: r.avg_penetrated != null ? Number(r.avg_penetrated) : null,
  }));
}

/**
 * 赛季高光榜：汇总每个玩家的 collateral/wallbang/noScope 击杀数
 * 三个趣味榜单，从 demoPlayerStats 按 season 聚合
 */
export interface PlayerHighlightStats {
  userId: string | null;
  perfectName: string;
  steamId64: string | null;
  maps: number;
  /** 集火击杀（一枪穿≥2人） */
  collateralKills: number;
  /** 穿墙击杀 */
  wallbangKills: number;
  /** 盲狙击杀（狙击未开镜） */
  noScopeKills: number;
}

export async function getSeasonHighlightStats(
  seasonId: string,
): Promise<ActionResult<PlayerHighlightStats[]>> {
  const { rows } = await db.execute(sql`
    SELECT
      dps.user_id,
      COALESCE(dp.name, 'Unknown') AS perfect_name,
      dp.steam_id64,
      count(*)::int AS maps,
      COALESCE(sum(dps.collateral_kill_count)::int, 0) AS collateral_kills,
      COALESCE(sum(dps.wallbang_kill_count)::int, 0) AS wallbang_kills,
      COALESCE(sum(dps.no_scope_kill_count)::int, 0) AS no_scope_kills
    FROM ${demoPlayerStats} dps
    JOIN ${demoImports} di ON di.id = dps.import_batch_id
    JOIN ${matchMaps} mm ON mm.id = di.map_id
    JOIN ${matches} m ON m.id = mm.match_id
    LEFT JOIN ${demoPlayers} dp
      ON dp.steam_id64 = dps.steam_id64 AND dp.import_batch_id = dps.import_batch_id
    WHERE m.season_id = ${seasonId}
      AND mm.active_stat_source = 'demo_import'::stat_source
    GROUP BY dps.user_id, dp.name, dp.steam_id64
    HAVING COALESCE(sum(dps.collateral_kill_count), 0) > 0
        OR COALESCE(sum(dps.wallbang_kill_count), 0) > 0
        OR COALESCE(sum(dps.no_scope_kill_count), 0) > 0
    ORDER BY collateral_kills DESC
    LIMIT 100
  `);

  return ok((rows as unknown as any[]).map((r: any) => ({
    userId: r.user_id as string | null,
    perfectName: (r.perfect_name as string) ?? "Unknown",
    steamId64: r.steam_id64 as string | null,
    maps: Number(r.maps ?? 0),
    collateralKills: Number(r.collateral_kills ?? 0),
    wallbangKills: Number(r.wallbang_kills ?? 0),
    noScopeKills: Number(r.no_scope_kills ?? 0),
  })));
}
