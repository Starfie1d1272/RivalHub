import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * Archive guard: once a season/tournament is archived, ordinary mutable
 * operations fail closed. Explicitly authorized post-event channels
 * (adjudications, honor lifecycle, sanction governance, audit viewing) live
 * outside this gate by design.
 */
export async function lockSeasonForTournamentInTx(
  txOrDb: Pick<TxDb, "select">,
  seasonId: string,
) {
  const [row] = await txOrDb
    .select({ status: seasons.status })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .for("update");
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "赛季不存在。");
  return row;
}

export async function assertSeasonAllowsTournamentMutationInTx(
  txOrDb: Pick<TxDb, "select">,
  seasonId: string,
): Promise<void> {
  const row = await lockSeasonForTournamentInTx(txOrDb, seasonId);
  if (row.status === "archived") {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      "赛季已归档，普通赛事变更被拒绝；请使用赛后裁决或荣誉专用操作。",
    );
  }
}
