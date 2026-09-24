import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { computeEventStats, computeDimensions } from "@/lib/utils/hexagon";
import type { PlayerMetrics, HexagonScores } from "@/lib/utils/hexagon";
import { perRound, ratioOfSums, roundWeightedAvg, roundsExpr, simpleAvg, completeSum, kdaOfSums } from "@/lib/stats";

type NumericPlayerMetrics = Omit<PlayerMetrics, "userId">;

function hasCompleteMetrics(
  values: { [key in keyof NumericPlayerMetrics]: number | null },
): values is NumericPlayerMetrics {
  return Object.values(values).every((value) => value != null && Number.isFinite(value) && value >= 0);
}

/** Event-local, normalized radar values. They are never averaged across events. */
export async function getSeasonHexagonScores(seasonId: string): Promise<Map<string, HexagonScores>> {
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
  const kdaExpr = kdaOfSums("mps.kills", "mps.assists", "mps.deaths");

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
      ${completeSum(roundsExpr)}::int AS total_rounds
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    JOIN match_maps mm ON mm.id = mps.map_id
    WHERE m.season_id = ${seasonId}
      AND mps.verified_by_admin IS NOT NULL
      AND mps.user_id IS NOT NULL
    GROUP BY mps.user_id
  `);

  if (rows.length === 0) return new Map();

  const toFinite = (value: unknown): number | null => {
    if (value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const players: PlayerMetrics[] = rows.flatMap((row) => {
    const values = {
      kpr: toFinite(row.kpr),
      dpr: toFinite(row.dpr),
      apr: toFinite(row.apr),
      kd: toFinite(row.kd),
      kda: toFinite(row.kda),
      fkpr: toFinite(row.fkpr),
      mkpr: toFinite(row.mkpr),
      cpr: toFinite(row.cpr),
      adr: toFinite(row.adr),
      rws: toFinite(row.rws),
      we: toFinite(row.we),
      ratingPro: toFinite(row.rating_pro),
      totalRounds: toFinite(row.total_rounds),
    };
    if (!hasCompleteMetrics(values) || values.totalRounds <= 0) return [];
    return [{ userId: row.user_id as string, ...values }];
  });

  const eventStats = computeEventStats(players);
  return new Map(players.map((player) => [player.userId, computeDimensions(player, eventStats)]));
}
