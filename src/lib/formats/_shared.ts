import { and, count, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";

/**
 * 检查某个 stage 的 matches 是否全部结束（无 scheduled / in_progress）。
 * 被所有 bracket 类 executor 共享。
 */
export async function isStageComplete(seasonId: string, stageKey: string): Promise<boolean> {
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(matches)
    .where(and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey)));
  if (total === 0) return false;

  const [{ value: active }] = await db
    .select({ value: count() })
    .from(matches)
    .where(
      and(
        eq(matches.seasonId, seasonId),
        eq(matches.stage, stageKey),
        sql`${matches.status} in ('scheduled', 'in_progress')`,
      ),
    );
  return active === 0;
}
