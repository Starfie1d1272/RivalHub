"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  computeEventStats,
  computeDimensions,
} from "@/lib/utils/hexagon";
import type { PlayerMetrics, HexagonScores } from "@/lib/utils/hexagon";
import {
  perRound,
  ratioOfSums,
  roundWeightedAvg,
  roundsExpr,
  simpleAvg,
  sumKnown,
} from "@/lib/stats";

type NumericPlayerMetrics = Omit<PlayerMetrics, "userId">;

function hasCompleteMetrics(
  values: { [key in keyof NumericPlayerMetrics]: number | null },
): values is NumericPlayerMetrics {
  return Object.values(values).every((value) => value != null && Number.isFinite(value) && value >= 0);
}

/**
 * 聚合赛事内所有有 verified 数据的选手的原始指标，
 * 计算六维雷达图分数（0-100）。
 *
 * 不加 HAVING count(*) >= 3，确保所有有数据的选手都参与标准化。
 */
export async function getSeasonHexagonScores(
  seasonId: string
): Promise<Map<string, HexagonScores>> {
  const kprExpr = perRound("mps.kills");
  const dprExpr = perRound("mps.deaths");
  const aprExpr = perRound("mps.assists");
  const fkprExpr = perRound("mps.first_kills");
  const mkprExpr = perRound("mps.multi_kills");
  const cprExpr = perRound("mps.clutches");
  const adrExpr = roundWeightedAvg("mps.adr");
  const rwsExpr = simpleAvg("mps.rws");
  const weExpr = simpleAvg("mps.we");
  const ratingExpr = simpleAvg("mps.rating_pro");
  const kdExpr = ratioOfSums("mps.kills", "mps.deaths");
  const killsSumExpr = sumKnown("mps.kills");
  const assistsSumExpr = sumKnown("mps.assists");
  const deathsSumExpr = sumKnown("mps.deaths");
  const kdaExpr = sql`CASE
    WHEN ${killsSumExpr} IS NOT NULL
      AND ${assistsSumExpr} IS NOT NULL
      AND ${deathsSumExpr} > 0
    THEN (${killsSumExpr} + ${assistsSumExpr})::numeric / ${deathsSumExpr}
    ELSE NULL
  END`;

  const { rows } = await db.execute(sql`
    SELECT
      mps.user_id,
      ${kprExpr} AS kpr,
      ${dprExpr} AS dpr,
      ${aprExpr} AS apr,
      ${fkprExpr} AS fkpr,
      ${mkprExpr} AS mkpr,
      ${cprExpr} AS cpr,
      ${adrExpr} AS adr,
      ${rwsExpr} AS rws,
      ${weExpr} AS we,
      ${ratingExpr} AS rating_pro,
      ${kdExpr} AS kd,
      ${kdaExpr} AS kda,
      sum(${roundsExpr}) FILTER (WHERE ${roundsExpr} IS NOT NULL)::int AS total_rounds
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

  const toFinite = (value: unknown): number | null => {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const players: PlayerMetrics[] = rows.flatMap((r) => {
    const values = {
      kpr: toFinite(r.kpr),
      dpr: toFinite(r.dpr),
      apr: toFinite(r.apr),
      kd: toFinite(r.kd),
      kda: toFinite(r.kda),
      fkpr: toFinite(r.fkpr),
      mkpr: toFinite(r.mkpr),
      cpr: toFinite(r.cpr),
      adr: toFinite(r.adr),
      rws: toFinite(r.rws),
      we: toFinite(r.we),
      ratingPro: toFinite(r.rating_pro),
      totalRounds: toFinite(r.total_rounds),
    };
    if (!hasCompleteMetrics(values)) return [];
    if (values.totalRounds <= 0) return [];
    return [{ userId: r.user_id as string, ...values }];
  });

  const eventStats = computeEventStats(players);

  const result = new Map<string, HexagonScores>();
  for (const player of players) {
    result.set(player.userId, computeDimensions(player, eventStats));
  }
  return result;
}
