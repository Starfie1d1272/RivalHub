import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { majorPrestartStates } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

/** Materialize and lock the per-season Major prestart state. */
export async function ensureMajorPrestartStateInTx(
  tx: TxDb,
  seasonId: string,
): Promise<typeof majorPrestartStates.$inferSelect> {
  await tx.insert(majorPrestartStates).values({ seasonId }).onConflictDoNothing();
  const [state] = await tx.select().from(majorPrestartStates)
    .where(eq(majorPrestartStates.seasonId, seasonId)).for("update");
  if (!state) throw new AppError(ErrorCode.INTERNAL_ERROR, "赛前状态初始化失败");
  return state;
}

export function assertMajorPrestartEntrantsMutable(state: { entrantsLockedAt: Date | null }): void {
  if (state.entrantsLockedAt) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "正式参赛队和最终名单已经锁定，不能再修改。");
  }
}
