import "server-only";
import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { lockMatchInTx } from "./locking";
import { concludeMatchExecution, type MatchConclusion } from "./execution";

/** No event advancement and no synthetic map results. Callers authorize before entering the transaction. */
export async function concludeUnassociatedMatchInTx(tx: TxDb, input: { matchId: string; actorId: string; conclusion: MatchConclusion; now?: Date }) {
  const match = await lockMatchInTx(tx, input.matchId);
  if (match.seasonId !== null) throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事比赛必须使用正式赛果流程。");
  const now = input.now ?? new Date();
  const conclusion = concludeMatchExecution(match, input.conclusion, now);
  await tx.update(matches).set({ status: conclusion.status, scoreA: conclusion.scoreA, scoreB: conclusion.scoreB, completedAt: now, resultDisposition: conclusion.result.kind, updatedAt: now }).where(eq(matches.id, match.id));
  await writeAuditInTx(tx, { action: "match.status_update", actorId: input.actorId, targetId: match.id, meta: { from: match.status, to: "finished", resultDisposition: conclusion.result.kind } });
  return conclusion;
}
