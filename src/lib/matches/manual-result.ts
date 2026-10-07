import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matchLiveSessions, matchMaps } from "@/db/schema";
import { lockMatchInTx } from "@/lib/match-rosters/service";
import { AppError, ErrorCode } from "@/lib/errors";
import { recordCanonicalMapResultInTx, supplementUnassociatedMapResultInTx, type CanonicalMapResultCommand } from "./results";

/** Manual entry uses the same match → source lock order as reliable ingress. */
export async function recordManualMapResultInTx(tx: TxDb, command: CanonicalMapResultCommand) {
  const match = await lockMatchInTx(tx, command.matchId);
  // Execution has ended; a source can no longer author live canonical results.
  if (match.testConfig && match.status === "finished") return supplementUnassociatedMapResultInTx(tx, command);
  const [source] = await tx.select().from(matchLiveSessions).where(and(eq(matchLiveSessions.matchId, command.matchId), isNull(matchLiveSessions.closedAt))).for("update");
  if (source) {
    const [map] = await tx.select().from(matchMaps).where(and(eq(matchMaps.matchId, command.matchId), eq(matchMaps.mapOrder, command.mapOrder)));
    if (source.autoCanonicalizationArmed || source.manualTakeoverMapEpoch !== source.mapEpoch || !map || source.currentMapId !== map.id) throw new AppError(ErrorCode.VALIDATION_FAILED, "本图由自动数据源负责，请先核对异常并明确人工接管本图。");
  }
  return recordCanonicalMapResultInTx(tx, command);
}
