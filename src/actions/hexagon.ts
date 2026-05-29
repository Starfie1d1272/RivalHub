"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  computeEventStats,
  computeDimensions,
} from "@/lib/utils/hexagon";
import type { PlayerMetrics, HexagonScores } from "@/lib/utils/hexagon";

/**
 * 聚合赛事内所有有 verified 数据的选手的原始指标，
 * 计算六维雷达图分数（0-100）。
 *
 * 不加 HAVING count(*) >= 3，确保所有有数据的选手都参与标准化。
 */
export async function getSeasonHexagonScores(
  seasonId: string
): Promise<Map<string, HexagonScores>> {
  // 回合数：优先 map 级（BO3/BO5），BO1 fallback 到 match 级
  const { rows } = await db.execute(sql`
    SELECT
      mps.user_id,
      sum(mps.kills)::float        / NULLIF(sum(COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)), 0)  AS kpr,
      sum(mps.deaths)::float       / NULLIF(sum(COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)), 0)  AS dpr,
      sum(mps.assists)::float      / NULLIF(sum(COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)), 0)  AS apr,
      sum(mps.first_kills)::float  / NULLIF(sum(COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)), 0)  AS fkpr,
      sum(mps.multi_kills)::float  / NULLIF(sum(COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)), 0)  AS mkpr,
      sum(mps.clutches)::float     / NULLIF(sum(COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)), 0)  AS cpr,
      sum(mps.adr * COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b))
        / NULLIF(sum(COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)), 0)                             AS adr,
      avg(mps.rws)                                                                                             AS rws,
      avg(mps.we)                                                                                              AS we,
      avg(mps.rating_pro)                                                                                      AS rating_pro,
      sum(mps.kills)::float        / NULLIF(sum(mps.deaths), 0)                                               AS kd,
      (sum(mps.kills) + sum(mps.assists))::float / NULLIF(sum(mps.deaths), 0)                                 AS kda,
      sum(COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b))::int                                      AS total_rounds
    FROM match_player_stats mps
    JOIN matches m  ON m.id  = mps.match_id
    JOIN match_maps mm ON mm.id = mps.map_id
    WHERE m.season_id = ${seasonId}
      AND mps.verified_by_admin IS NOT NULL
      AND mps.source = COALESCE(mm.active_stat_source, 'manual_ocr'::stat_source)
      AND mps.user_id IS NOT NULL
    GROUP BY mps.user_id
  `);

  if (rows.length === 0) {
    return new Map();
  }

  // Demo 子指标：从 demo_player_stats 聚合（仅 active_stat_source='demo_import' 的图）
  const { rows: demoRows } = await db.execute(sql`
    SELECT
      dps.user_id,
      avg(dps.kast)::float                                                        AS kast,
      sum(dps.utility_damage)::float
        / NULLIF(sum(rc.round_count), 0)                                          AS utility_damage_pr,
      sum(dps.first_kill_count)::float
        / NULLIF(sum(rc.round_count), 0)                                          AS first_kill_rate,
      (sum(
         dps.vs_one_won_count + dps.vs_two_won_count + dps.vs_three_won_count +
         dps.vs_four_won_count + dps.vs_five_won_count
       ))::float
       / NULLIF(sum(
           dps.vs_one_count + dps.vs_two_count + dps.vs_three_count +
           dps.vs_four_count + dps.vs_five_count
         ), 0)                                                                     AS clutch_win_rate,
      sum(dps.trade_kill_count)::float
        / NULLIF(sum(rc.round_count), 0)                                          AS trade_kill_rate,
      sum(dps.first_kill_count)::float
        / NULLIF(sum(dps.first_kill_count + dps.first_death_count), 0)            AS entry_success_rate
    FROM demo_player_stats dps
    JOIN demo_imports di ON di.id = dps.import_batch_id
    JOIN match_maps mm ON mm.id = di.map_id
    JOIN matches m ON m.id = mm.match_id
    JOIN (
      SELECT import_batch_id, count(*)::int AS round_count
      FROM demo_rounds
      GROUP BY import_batch_id
    ) rc ON rc.import_batch_id = dps.import_batch_id
    WHERE m.season_id = ${seasonId}
      AND mm.active_stat_source = 'demo_import'::stat_source
      AND dps.user_id IS NOT NULL
    GROUP BY dps.user_id
  `);

  const nd = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : 0);

  const demoMetricMap = new Map<string, {
    kast: number;
    utilityDamagePr: number;
    firstKillRate: number;
    clutchWinRate: number;
    tradeKillRate: number;
    entrySuccessRate: number;
    hasDemoData: boolean;
  }>();
  for (const r of demoRows) {
    if (r.user_id) {
      demoMetricMap.set(r.user_id as string, {
        kast: nd(r.kast),
        utilityDamagePr: nd(r.utility_damage_pr),
        firstKillRate: nd(r.first_kill_rate),
        clutchWinRate: nd(r.clutch_win_rate),
        tradeKillRate: nd(r.trade_kill_rate),
        entrySuccessRate: nd(r.entry_success_rate),
        hasDemoData: true,
      });
    }
  }

  const n = (v: unknown) => Number(v) || 0;

  const players: PlayerMetrics[] = rows.map((r) => {
    const demoData = demoMetricMap.get(r.user_id as string);
    return {
      userId:      r.user_id as string,
      kpr:         n(r.kpr),
      dpr:         n(r.dpr),
      apr:         n(r.apr),
      kd:          n(r.kd),
      kda:         n(r.kda),
      fkpr:        n(r.fkpr),
      mkpr:        n(r.mkpr),
      cpr:         n(r.cpr),
      adr:         n(r.adr),
      rws:         n(r.rws),
      we:          n(r.we),
      ratingPro:   n(r.rating_pro),
      totalRounds: n(r.total_rounds),
      kast:             demoData?.kast ?? 0,
      utilityDamagePr:  demoData?.utilityDamagePr ?? 0,
      firstKillRate:    demoData?.firstKillRate ?? 0,
      clutchWinRate:    demoData?.clutchWinRate ?? 0,
      tradeKillRate:    demoData?.tradeKillRate ?? 0,
      entrySuccessRate: demoData?.entrySuccessRate ?? 0,
      hasDemoData:      demoData?.hasDemoData ?? false,
    };
  });

  const eventStats = computeEventStats(players);

  const result = new Map<string, HexagonScores>();
  for (const player of players) {
    result.set(player.userId, computeDimensions(player, eventStats));
  }
  return result;
}
