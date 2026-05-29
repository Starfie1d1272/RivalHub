"use server";

import { db } from "@/db/client";
import { sql, eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/session";
import { demoRounds } from "@/db/schema/demo";
import { ok, fail, type ActionResult } from "@/types/action";
import { ErrorCode } from "@/lib/errors";

/**
 * 从 demo_player_economies.type 回填 demo_rounds.team_a/b_economy。
 *
 * 来源：insight 导出的 economies.json 已含按选手每回合的经济分类
 * （eco/force/full_buy/pistol），直接多数决后写入。
 *
 * 队伍级：多数胜出。平手按 eco < force < full < pistol 优先。
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
    WITH typed AS (
      SELECT
        dpe.import_batch_id,
        dpe.round_number,
        dpe.map_id,
        dpe.team_key,
        CASE dpe.type
          WHEN 'full_buy' THEN 'full'
          ELSE dpe.type
        END AS economy_type
      FROM demo_player_economies dpe
      WHERE dpe.type IS NOT NULL
        ${batchFilter}
    ),
    team_votes AS (
      SELECT
        import_batch_id,
        round_number,
        map_id,
        team_key,
        economy_type,
        COUNT(*) AS votes
      FROM typed
      GROUP BY import_batch_id, round_number, map_id, team_key, economy_type
    ),
    team_decision AS (
      SELECT DISTINCT ON (import_batch_id, round_number, team_key)
        import_batch_id,
        round_number,
        team_key,
        economy_type AS team_economy
      FROM team_votes
      ORDER BY
        import_batch_id,
        round_number,
        team_key,
        votes DESC,
        CASE economy_type
          WHEN 'eco'    THEN 0
          WHEN 'force'  THEN 1
          WHEN 'full'   THEN 2
          WHEN 'pistol' THEN 3
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
