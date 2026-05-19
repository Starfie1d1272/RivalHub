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
      AND mps.user_id IS NOT NULL
    GROUP BY mps.user_id
  `);

  if (rows.length === 0) {
    return new Map();
  }

  const n = (v: unknown) => Number(v) || 0;

  const players: PlayerMetrics[] = rows.map((r) => ({
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
  }));

  const eventStats = computeEventStats(players);

  const result = new Map<string, HexagonScores>();
  for (const player of players) {
    result.set(player.userId, computeDimensions(player, eventStats));
  }
  return result;
}
