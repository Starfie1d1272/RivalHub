"use server";

import { db } from "@/db/client";
import { sql, eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/session";
import { demoRounds } from "@/db/schema/demo";
import { ok, fail, type ActionResult } from "@/types/action";
import { ErrorCode } from "@/lib/errors";

/**
 * 从 demo_player_economies 计算每回合队伍经济类型并回填 demo_rounds。
 *
 * 分类规则（per-player）：
 *   - eco:     money_spent < 1000（基本没买）
 *   - full:    equipment_value >= 4000（AK+甲+投掷物起步）
 *   - force:   花钱比例 > 75%（买完不留钱）
 *   - semi:    money_spent >= 1000 且花钱比例 <= 75%（留钱）
 *
 * 队伍级：多数胜出。平手时按 eco < semi < force < full 优先。
 * 仅更新未设置（IS NULL）的行，或指定 import_batch_ids 时全量重算。
 */
export async function backfillEconomyTypes(
  importBatchIds?: string[],
): Promise<ActionResult<{ updatedRounds: number }>> {
  try {
    await requireAdmin();
  } catch {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "需要管理员权限" });
  }

  const batchFilter = importBatchIds?.length
    ? sql`AND dpe.import_batch_id = ANY(${importBatchIds}::uuid[])`
    : sql``;

  const result = await db.execute(sql`
    WITH per_player AS (
      SELECT
        dpe.import_batch_id,
        dpe.round_number,
        dpe.map_id,
        dpe.team_key,
        dpe.start_money,
        dpe.money_spent,
        dpe.equipment_value,
        CASE
          WHEN dpe.money_spent < 1000 THEN 'eco'
          WHEN dpe.equipment_value >= 4000 THEN 'full'
          WHEN dpe.start_money > 0
            AND (dpe.money_spent::float / dpe.start_money) > 0.75 THEN 'force'
          WHEN dpe.money_spent >= 1000 THEN 'semi'
          ELSE 'eco'
        END AS eco_type
      FROM demo_player_economies dpe
      WHERE dpe.start_money > 0
        ${batchFilter}
    ),
    team_votes AS (
      SELECT
        import_batch_id,
        round_number,
        map_id,
        team_key,
        eco_type,
        COUNT(*) AS votes
      FROM per_player
      GROUP BY import_batch_id, round_number, map_id, team_key, eco_type
    ),
    team_decision AS (
      SELECT DISTINCT ON (import_batch_id, round_number, team_key)
        import_batch_id,
        round_number,
        team_key,
        eco_type AS team_economy
      FROM team_votes
      ORDER BY
        import_batch_id,
        round_number,
        team_key,
        votes DESC,
        CASE eco_type
          WHEN 'eco'   THEN 0
          WHEN 'semi'  THEN 1
          WHEN 'force' THEN 2
          WHEN 'full'  THEN 3
        END DESC
    ),
    updated_a AS (
      UPDATE demo_rounds dr
      SET team_a_economy = td.team_economy
      FROM team_decision td
      WHERE td.team_key = 'teamA'
        AND dr.import_batch_id = td.import_batch_id
        AND dr.round_number = td.round_number
        AND dr.team_a_economy IS DISTINCT FROM td.team_economy
      RETURNING dr.id
    ),
    updated_b AS (
      UPDATE demo_rounds dr
      SET team_b_economy = td.team_economy
      FROM team_decision td
      WHERE td.team_key = 'teamB'
        AND dr.import_batch_id = td.import_batch_id
        AND dr.round_number = td.round_number
        AND dr.team_b_economy IS DISTINCT FROM td.team_economy
      RETURNING dr.id
    )
    SELECT
      (SELECT count(*) FROM updated_a)
      + (SELECT count(*) FROM updated_b) AS updated_rounds
  `);

  const updated = Number((result as any).rows?.[0]?.updated_rounds ?? 0);
  return ok({ updatedRounds: updated });
}

/**
 * 为单次导入批次的全部回合计算经济类型并回填。
 * 在 imports 事务提交后调用。
 */
export async function backfillSingleBatch(
  importBatchId: string,
): Promise<void> {
  await backfillEconomyTypes([importBatchId]);
}
