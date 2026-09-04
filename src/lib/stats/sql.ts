import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * 回合数表达式：所有 format 均只从实际已记录地图的回合比分计算。
 * 依赖 SQL 别名：mm = match_maps
 */
export const roundsExpr: SQL = sql`mm.score_a + mm.score_b`;

function rawColumn(col: string): SQL {
  return sql.raw(col);
}

/** 已知 source 的简单图均值；PostgreSQL avg 本身会跳过 NULL。 */
export function simpleAvg(col: string): SQL {
  return sql`avg(${rawColumn(col)})`;
}

/** 已知 source 的 count 总和；所有 source 都是 NULL 时返回 NULL。 */
export function sumKnown(col: string): SQL {
  return sql`sum(${rawColumn(col)})`;
}

/** 两个已知 count 总和之比；分子或有效分母缺失/为零时返回 NULL。 */
export function ratioOfSums(numerator: string, denominator: string): SQL {
  return sql`CASE
    WHEN sum(${rawColumn(numerator)}) IS NOT NULL AND sum(${rawColumn(denominator)}) > 0
    THEN sum(${rawColumn(numerator)})::numeric / sum(${rawColumn(denominator)})
    ELSE NULL
  END`;
}

/**
 * 回合加权均值 — ADR 跨图聚合的正确方式
 * 依赖别名：mm
 */
export function roundWeightedAvg(col: string): SQL {
  const known = sql`${rawColumn(col)} IS NOT NULL AND ${roundsExpr} IS NOT NULL`;
  return sql`CASE WHEN sum(${roundsExpr}) FILTER (WHERE ${known}) > 0
    THEN (sum(${rawColumn(col)} * ${roundsExpr}) FILTER (WHERE ${known}))::numeric
      / sum(${roundsExpr}) FILTER (WHERE ${known})
    ELSE NULL END`;
}

/**
 * 击杀数加权均值 — HS% 跨图聚合的正确方式
 * 依赖别名：mps = match_player_stats
 */
export function killWeightedAvg(col: string): SQL {
  const known = sql`${rawColumn(col)} IS NOT NULL AND mps.kills IS NOT NULL`;
  return sql`CASE WHEN sum(mps.kills) FILTER (WHERE ${known}) > 0
    THEN (sum(${rawColumn(col)} * mps.kills) FILTER (WHERE ${known}))::numeric
      / sum(mps.kills) FILTER (WHERE ${known})
    ELSE NULL END`;
}

/**
 * 每回合率 — KPR / FKPR / MKPR / CPR 的正确聚合方式
 * 依赖别名：mm
 */
export function perRound(col: string): SQL {
  const known = sql`${rawColumn(col)} IS NOT NULL AND ${roundsExpr} IS NOT NULL`;
  return sql`CASE WHEN sum(${roundsExpr}) FILTER (WHERE ${known}) > 0
    THEN (sum(${rawColumn(col)}) FILTER (WHERE ${known}))::numeric
      / sum(${roundsExpr}) FILTER (WHERE ${known})
    ELSE NULL END`;
}
