"use server";

import { eq, and, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matchMaps } from "@/db/schema/match-maps";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { demoImports } from "@/db/schema/demo";
import { requireAdmin } from "@/lib/auth/session";
import { ok, fail, type ActionResult } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import { revalidatePath } from "next/cache";

const DEMO_TABLES = [
  "demo_kills", "demo_damages", "demo_blinds", "demo_bombs",
  "demo_clutches", "demo_grenades", "demo_shots", "demo_positions",
  "demo_player_economies", "demo_player_stats", "demo_rounds", "demo_players",
] as const;

/**
 * 删除指定地图的全部 Demo 导入记录及关联数据。
 * 用于重新导出后需要重新导入的场景（exporter 修复了队伍名等）。
 */
export async function deleteDemoImport(
  mapId: string,
): Promise<ActionResult<void>> {
  try {
    await requireAdmin();
  } catch {
    return fail({ code: ErrorCode.UNAUTHORIZED, message: "需要管理员权限" });
  }

  const batches = await db
    .select({ id: demoImports.id })
    .from(demoImports)
    .where(eq(demoImports.mapId, mapId));

  if (batches.length === 0) {
    return fail({ code: ErrorCode.NOT_FOUND, message: "该地图没有 Demo 导入记录" });
  }

  const batchIds = batches.map((b) => b.id);

  try {
    await db.transaction(async (tx) => {
      // 1. 删 match_player_stats 中的 demo 行
      await tx.delete(matchPlayerStats).where(
        and(eq(matchPlayerStats.mapId, mapId), eq(matchPlayerStats.source, "demo_import"))
      );

      // 2. 删所有 demo_* 子表
      for (const table of DEMO_TABLES) {
        await tx.execute(
          sql`DELETE FROM ${sql.identifier(table)} WHERE import_batch_id = ANY(${batchIds}::uuid[])`
        );
      }

      // 3. 删 demo_imports
      await tx.delete(demoImports).where(eq(demoImports.mapId, mapId));

      // 4. 重置生效来源
      await tx.update(matchMaps)
        .set({ activeStatSource: null })
        .where(eq(matchMaps.id, mapId));
    });

    revalidatePath("/admin/[seasonSlug]/demos", "page");
    return ok(undefined);
  } catch (e) {
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: String(e) });
  }
}
