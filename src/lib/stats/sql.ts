import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * 回合数表达式：所有 format 均只从实际已记录地图的回合比分计算。
 * 依赖 SQL 别名：mm = match_maps
 */
export const roundsExpr: SQL = sql`mm.score_a + mm.score_b`;

/**
 * 回合加权均值 — ADR 跨图聚合的正确方式
 * 依赖别名：mm
 */
export function roundWeightedAvg(col: string): SQL {
  return sql`CASE WHEN sum(${roundsExpr}) > 0
    THEN sum(${sql.raw(col)} * ${roundsExpr})::numeric / sum(${roundsExpr})
    ELSE NULL END`;
}

/**
 * 击杀数加权均值 — HS% 跨图聚合的正确方式
 * 依赖别名：mps = match_player_stats
 */
export function killWeightedAvg(col: string): SQL {
  return sql`CASE WHEN sum(mps.kills) > 0
    THEN sum(${sql.raw(col)} * mps.kills)::numeric / sum(mps.kills)
    ELSE NULL END`;
}

/**
 * 每回合率 — KPR / FKPR / MKPR / CPR 的正确聚合方式
 * 依赖别名：mm
 */
export function perRound(col: string): SQL {
  return sql`CASE WHEN sum(${roundsExpr}) > 0
    THEN sum(${sql.raw(col)})::numeric / sum(${roundsExpr})
    ELSE NULL END`;
}
