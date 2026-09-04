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

/** 原始总计要求所有纳入行都有 source；任一 NULL 即返回 NULL。 */
export function completeSum(col: string | SQL): SQL {
  const expression = typeof col === "string" ? rawColumn(col) : col;
  return sql`CASE
    WHEN count(${expression}) = count(*) THEN sum(${expression})
    ELSE NULL
  END`;
}

/** 两个完整 raw total 之比；任一 total 缺失或有效分母为零时返回 NULL。 */
export function ratioOfSums(numerator: string, denominator: string): SQL {
  const numeratorSum = completeSum(numerator);
  const denominatorSum = completeSum(denominator);
  return sql`CASE
    WHEN ${numeratorSum} IS NOT NULL AND ${denominatorSum} > 0
    THEN ${numeratorSum}::numeric / ${denominatorSum}
    ELSE NULL
  END`;
}

/** 三个完整 raw total 的 KDA；任一 total 缺失或死亡数为零时返回 NULL。 */
export function kdaOfSums(kills: string, assists: string, deaths: string): SQL {
  const killsSum = completeSum(kills);
  const assistsSum = completeSum(assists);
  const deathsSum = completeSum(deaths);
  return sql`CASE
    WHEN ${killsSum} IS NOT NULL
      AND ${assistsSum} IS NOT NULL
      AND ${deathsSum} > 0
    THEN (${killsSum} + ${assistsSum})::numeric / ${deathsSum}
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
