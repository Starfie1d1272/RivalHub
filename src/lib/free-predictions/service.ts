import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { users, competitionQualificationRuns, freePredictionChoices as choices, freePredictionRequests as requests, freePredictionLocks as locks } from "@/db/schema";
import { lockMatchInTx } from "@/lib/matches/locking";
import { loadBetFacts } from "@/lib/bet/facts";
import { marketIsLocked, sameIds } from "@/lib/bet/domain";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import { AppError, ErrorCode } from "@/lib/errors";
import { predictionInput, freePredictionCompetitionIsOpen } from "./domain";
import type { FreePredictionKind, FreePredictionSubject } from "./types";
export interface SubmitFreePrediction { seasonId: string; matchId: string; userId: string; kind: FreePredictionKind; selection: string[]; requestId: string }
function invalid(message: string): never { throw new AppError(ErrorCode.VALIDATION_FAILED, message); }
export async function submitFreePredictionInTx(tx: TxDb, input: SubmitFreePrediction) {
  // Same first lock as canonical game/BP transitions. No BET program/account lock.
  const match = await lockMatchInTx(tx, input.matchId);
  if (match.seasonId !== input.seasonId || match.testConfig) invalid("比赛不可预测");
  const [user] = await tx.select().from(users).where(eq(users.id,input.userId)).for("share");
  if (!user || user.status !== "active" || !user.emailVerifiedAt) throw new AppError(ErrorCode.FORBIDDEN,"请先完成邮箱验证");
  const f = await loadBetFacts(tx,input.seasonId,{matchId:input.matchId,event:false,rosterUserId:null});
  const official = f.official.find(m => m.id === input.matchId);
  const qualificationRun = official?.qualificationRunId ? await tx.query.competitionQualificationRuns.findFirst({
    where: and(eq(competitionQualificationRuns.id, official.qualificationRunId), eq(competitionQualificationRuns.seasonId, input.seasonId)),
  }) : undefined;
  if (!official || !freePredictionCompetitionIsOpen(f.season, official, qualificationRun)) invalid("比赛不可预测");
  const selection = [...input.selection].sort();
  if (input.kind !== "result" && input.kind !== "bp") invalid("预测类型无效");
  const [receipt] = await tx.select({receipt:requests,choice:choices}).from(requests).innerJoin(choices,eq(choices.id,requests.choiceId))
    .where(and(eq(requests.userId,input.userId),eq(requests.requestId,input.requestId)));
  if (receipt) {
    if (receipt.choice.matchId !== input.matchId || receipt.choice.seasonId !== input.seasonId || receipt.choice.kind !== input.kind || !sameIds(receipt.receipt.selection,selection)) invalid("请求编号已使用");
    return { choiceId: receipt.choice.id, replayed: true };
  }
  const veto = f.vetoByMatch.get(input.matchId);
  const mapPool = veto?.mapPoolSnapshot ?? normalizeRegistrationConfig(f.season.registrationConfig).mapPool;
  const subject: FreePredictionSubject = {entryIds:[official.entryAId,official.entryBId],runId:(official.majorStageRunId??official.qualificationRunId)!,format:official.format,mapPool:input.kind === "bp" ? [...mapPool].sort() : []};
  const expected = input.kind === "bp" ? Number(official.format.slice(2)) : 1;
  if (selection.length !== expected || new Set(selection).size !== expected || !selection.every(s => (input.kind === "bp" ? mapPool : subject.entryIds).includes(s))) invalid("请检查所选队伍或地图");
  const [lock] = await tx.select().from(locks).where(eq(locks.matchId,input.matchId));
  const fact = predictionInput(subject,{match:official,maps:f.maps.filter(m=>m.matchId===input.matchId),veto,event:f.event});
  if ((input.kind === "bp" ? lock?.bpLockedAt : lock?.resultLockedAt) || marketIsLocked({...fact,type:input.kind === "bp" ? "veto_map" : "match_winner"})) invalid("预测已锁定");
  const [choice] = await tx.insert(choices).values({...input,selection,subject}).onConflictDoUpdate({target:[choices.userId,choices.matchId,choices.kind],set:{selection,subject,updatedAt:sql`clock_timestamp()`}}).returning();
  await tx.insert(requests).values({userId:input.userId,requestId:input.requestId,choiceId:choice!.id,selection});
  return {choiceId:choice!.id,replayed:false};
}
