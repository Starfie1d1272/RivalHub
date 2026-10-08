import "server-only";
import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, matchMaps, type Match } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { lockMatchInTx } from "./locking";
import { concludeMatchExecution, type MatchConclusion } from "./execution";
import { validateMapScore, validateSeriesAgainstMaps } from "./result-rules";

type Command = { matchId: string; actorId: string; conclusion: MatchConclusion; now?: Date };
const resultFact = (match: Match) => ({ disposition: match.resultDisposition, scoreA: match.scoreA, scoreB: match.scoreB });
function assertIndependent(match: Match) {
  if (match.seasonId !== null && !match.testConfig) throw new AppError(ErrorCode.VALIDATION_FAILED, "正式赛事比赛必须使用正式赛果流程。");
}
function sameResult(match: Match, conclusion: MatchConclusion) {
  return match.resultDisposition === conclusion.kind && match.scoreA === (conclusion.kind === "recorded" ? conclusion.scoreA : null) && match.scoreB === (conclusion.kind === "recorded" ? conclusion.scoreB : null);
}
async function persistConclusion(tx: TxDb, match: Match, input: Command, operation: string, reason?: string) {
  const maps = await tx.select().from(matchMaps).where(eq(matchMaps.matchId, match.id));
  if (input.conclusion.kind === "recorded") validateSeriesAgainstMaps(match.format, input.conclusion.scoreA, input.conclusion.scoreB, maps);
  const now = input.now ?? new Date();
  const conclusion = concludeMatchExecution(match, input.conclusion, now);
  if (match.status === "finished" && sameResult(match, input.conclusion)) return conclusion;
  await tx.update(matches).set({ status: conclusion.status, scoreA: conclusion.scoreA, scoreB: conclusion.scoreB, completedAt: conclusion.completedAt, resultDisposition: conclusion.result.kind, updatedAt: now }).where(eq(matches.id, match.id));
  await writeAuditInTx(tx, { seasonId: match.seasonId, action: "match.status_update", actorId: input.actorId, targetId: match.id, meta: { operation, reason, from: match.status, to: "finished", before: resultFact(match), after: { disposition: conclusion.result.kind, scoreA: conclusion.scoreA, scoreB: conclusion.scoreB } } });
  return conclusion;
}

/** First execution end only; exact retries are idempotent. Callers own authorization. */
export async function concludeUnassociatedMatchInTx(tx: TxDb, input: Command) {
  const match = await lockMatchInTx(tx, input.matchId);
  assertIndependent(match);
  if (match.status === "finished" && !sameResult(match, input.conclusion)) throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已结束，请使用结果补录或更正流程。");
  return persistConclusion(tx, match, input, "end_execution");
}

/** Resolve a pending result without reopening execution or changing its end time. */
export async function supplementUnassociatedResultInTx(tx: TxDb, input: Command) {
  const match = await lockMatchInTx(tx, input.matchId);
  assertIndependent(match);
  if (match.status !== "finished" || (match.resultDisposition !== "pending" && !sameResult(match, input.conclusion))) throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有已结束、待补结果的比赛可以补录结论。");
  return persistConclusion(tx, match, input, "supplement_result");
}

/** Reviewed correction is atomic across existing map evidence and the final result. */
export async function correctUnassociatedResultInTx(tx: TxDb, input: Command & {
  expectedUpdatedAt: Date; reason: string;
  maps?: readonly { mapId: string; scoreA: number; scoreB: number }[];
}) {
  const match = await lockMatchInTx(tx, input.matchId);
  assertIndependent(match);
  if (match.status !== "finished" || match.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() || !input.reason.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "请重新核对比赛结果并填写更正原因。");
  const maps = await tx.select().from(matchMaps).where(eq(matchMaps.matchId, match.id));
  const corrections = input.maps ?? [];
  if (new Set(corrections.map(map => map.mapId)).size !== corrections.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "不能重复更正同一张地图。");
  for (const correction of corrections) {
    const before = maps.find(map => map.id === correction.mapId);
    if (!before || before.scoreA === null || before.scoreB === null) throw new AppError(ErrorCode.VALIDATION_FAILED, "只能更正本场已有单图结果。");
    validateMapScore(correction.scoreA, correction.scoreB);
    await tx.update(matchMaps).set({ scoreA: correction.scoreA, scoreB: correction.scoreB }).where(eq(matchMaps.id, before.id));
  }
  const result = await persistConclusion(tx, match, input, "correct_result", input.reason.trim());
  if (corrections.length) {
    await tx.update(matches).set({ updatedAt: input.now ?? new Date() }).where(eq(matches.id, match.id));
    await writeAuditInTx(tx, { seasonId: match.seasonId, action: "match.status_update", actorId: input.actorId, targetId: match.id, meta: { operation: "correct_map_evidence", reason: input.reason.trim(), before: maps.filter(map => corrections.some(c => c.mapId === map.id)).map(map => ({ mapId: map.id, scoreA: map.scoreA, scoreB: map.scoreB })), after: corrections } });
  }
  return result;
}
