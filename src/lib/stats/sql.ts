import { sql, and, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { StatFilter } from "./types";
import type { DB } from "@/db/client";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { matches, seasons } from "@/db/schema";

/**
 * 回合数表达式：优先图级比分（BO3/BO5），BO1 fallback 到赛事级比分。
 * 依赖 SQL 别名：mm = match_maps, m = matches
 */
export const roundsExpr: SQL = sql`COALESCE(mm.score_a + mm.score_b, m.score_a + m.score_b)`;

/**
 * 回合加权均值 — ADR 跨图聚合的正确方式
 * 依赖别名：mm, m
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
 * 依赖别名：mm, m
 */
export function perRound(col: string): SQL {
  return sql`CASE WHEN sum(${roundsExpr}) > 0
    THEN sum(${sql.raw(col)})::numeric / sum(${roundsExpr})
    ELSE NULL END`;
}

/**
 * 根据 StatFilter 生成附加 WHERE 条件（追加到现有 WHERE 之后）
 * 依赖别名：m = matches, mm = match_maps
 * 返回空 SQL 时不添加任何条件
 */
export function filterToSql(filter: Pick<StatFilter, "stage" | "mapName" | "format">): SQL {
  const parts: SQL[] = [];
  if (filter.stage) parts.push(sql`AND m.stage = ${filter.stage}`);
  if (filter.mapName) parts.push(sql`AND mm.map_name = ${filter.mapName}`);
  if (filter.format) parts.push(sql`AND m.format = ${filter.format}`);
  if (parts.length === 0) return sql``;
  return sql.join(parts, sql` `);
}

/**
 * OCR 源 rating_pro / rws / we 回退聚合（CTE 体）。
 *
 * demo_import 源的行这三列为 NULL，统计时需从 manual_ocr 源取 COALESCE 值。
 * 产物列：avg_rating_ocr, avg_rws_ocr, avg_we_ocr。
 *
 * 使用方法：
 * ```sql
 * WITH ocr_avg AS (${ocrFallbackCte(sql`${seasonId}`)})
 * SELECT COALESCE(round(avg(mps.rating_pro)::numeric, 2), min(ocr.avg_rating_ocr)) ...
 * ```
 */
export function ocrFallbackCte(seasonId: SQL): SQL {
  return sql`
    SELECT
      mps2.user_id,
      round(avg(mps2.rating_pro)::numeric, 2) AS avg_rating_ocr,
      round(avg(mps2.rws)::numeric, 2)        AS avg_rws_ocr,
      round(avg(mps2.we)::numeric, 1)         AS avg_we_ocr
    FROM match_player_stats mps2
    JOIN matches m2 ON m2.id = mps2.match_id
    WHERE mps2.source = 'manual_ocr'
      AND mps2.verified_by_admin IS NOT NULL
      AND m2.season_id = ${seasonId}
    GROUP BY mps2.user_id
  `;
}

/**
 * 查询指定用户在 manual_ocr 源的 rating_pro / rws / we 按赛季聚合。
 * 用于选手页 OCR 指标回填，替代内联查询。
 * 返回 Map<seasonId, {avgRating, avgRws, avgWe}>。
 */
export async function getOcrAveragesBySeason(
  db: DB,
  userId: string,
): Promise<Map<string, { avgRating: number | null; avgRws: number | null; avgWe: number | null }>> {
  const rows = await db
    .select({
      seasonId: seasons.id,
      avgRws:    sql<number | null>`round(avg(${matchPlayerStats.rws})::numeric, 2)`,
      avgWe:     sql<number | null>`round(avg(${matchPlayerStats.we})::numeric, 1)`,
      avgRating: sql<number | null>`round(avg(${matchPlayerStats.ratingPro})::numeric, 2)`,
    })
    .from(matchPlayerStats)
    .innerJoin(matches, eq(matchPlayerStats.matchId, matches.id))
    .where(
      and(
        eq(matchPlayerStats.userId, userId),
        sql`${matchPlayerStats.verifiedByAdmin} IS NOT NULL`,
        sql`${matchPlayerStats.source} = 'manual_ocr'::stat_source`,
      ),
    )
    .groupBy(matches.seasonId);

  return new Map(
    rows
      .filter((r) => r.seasonId != null)
      .map((r) => [r.seasonId!, {
        avgRating: r.avgRating != null ? Number(r.avgRating) : null,
        avgRws:    r.avgRws    != null ? Number(r.avgRws)    : null,
        avgWe:     r.avgWe     != null ? Number(r.avgWe)     : null,
      }]),
  );
}
