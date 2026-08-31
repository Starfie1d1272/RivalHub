import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, majorStageRuns, matches } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { validateSeriesScore } from "@/lib/matches/result-rules";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { parseMajorRunSnapshot } from "@/lib/major/run-snapshot";
import { loadMajorStageEntrantsInTx } from "@/lib/major/run-entrants";
import {
  generateNextMajorSwissRound,
  projectMajorSwissStage,
  type MajorSwissFinalizedRound,
  type MajorSwissMatchFact,
  type MajorSwissRound,
} from "@/lib/major/swiss";

export interface MajorSwissRoundFinalizationResult {
  stageRunId: string;
  finalizedRound: MajorSwissRound;
  createdNextRound: number;
  stageComplete: boolean;
  alreadyFinalized: boolean;
}

interface FrozenSwissStage {
  key: string;
  type: "swiss";
  teamCount: 16;
  matchFormat: "bo1" | "bo3";
}

function frozenSwissStage(snapshot: unknown, stageKey: string): FrozenSwissStage {
  const value = parseMajorRunSnapshot(snapshot, stageKey).stage as Partial<FrozenSwissStage>;
  if (typeof value.key !== "string" || value.type !== "swiss" || value.teamCount !== 16 || (value.matchFormat !== "bo1" && value.matchFormat !== "bo3")) {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前 Stage 不是可运行的 16 队 Major Swiss 阶段。");
  }
  return value as FrozenSwissStage;
}

function asFinalizedRound(value: number): MajorSwissFinalizedRound {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  throw new AppError(ErrorCode.INTERNAL_ERROR, "Stage 运行的已确认轮次无效。");
}

function pairKey(entryAId: string, entryBId: string): string {
  return entryAId < entryBId ? `${entryAId}\u0000${entryBId}` : `${entryBId}\u0000${entryAId}`;
}

function completedFact(match: typeof matches.$inferSelect): MajorSwissMatchFact {
  if (match.round === null || match.round < 1 || match.round > 5) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "托管 Swiss 比赛缺少有效轮次。");
  }
  if (match.status !== "finished" || match.completedAt === null || match.scoreA === null || match.scoreB === null) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `第 ${match.round} 轮仍有未完成或无正式比分的比赛。`);
  }
  try {
    validateSeriesScore(match.format, match.scoreA, match.scoreB);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `第 ${match.round} 轮存在非法正式比分，不能确认本轮。`);
  }
  return {
    matchId: match.id,
    round: match.round as MajorSwissRound,
    entryAId: match.entryAId,
    entryBId: match.entryBId,
    winnerId: match.scoreA > match.scoreB ? match.entryAId : match.entryBId,
  };
}

/**
 * Atomically accepts one already-complete Major Swiss round and creates the
 * next round's managed matches. The locked StageRun row serializes retries and
 * concurrent operator clicks; no legacy swiss_standings data is consulted.
 */
export async function finalizeMajorSwissRoundInTransaction(
  tx: TxDb,
  input: { seasonId: string; stageRunId: string; expectedRound: MajorSwissRound; actorId: string },
): Promise<MajorSwissRoundFinalizationResult> {
  await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
  const [stageRun] = await tx.select().from(majorStageRuns)
    .where(and(eq(majorStageRuns.id, input.stageRunId), eq(majorStageRuns.seasonId, input.seasonId))).for("update");
  if (!stageRun) throw new AppError(ErrorCode.NOT_FOUND, "指定的 Major StageRun 不属于当前赛事。 ");

  const stage = frozenSwissStage(stageRun.ruleSnapshot, stageRun.stageKey);
  if (stage.key !== stageRun.stageKey) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Stage 运行规则快照与记录不一致。 ");
  }
  const finalizedRound = asFinalizedRound(stageRun.finalizedRound);
  if (finalizedRound >= input.expectedRound) {
    return {
      stageRunId: stageRun.id,
      finalizedRound: finalizedRound as MajorSwissRound,
      createdNextRound: 0,
      stageComplete: finalizedRound === 5,
      alreadyFinalized: true,
    };
  }
  if (input.expectedRound !== finalizedRound + 1) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, `当前应确认第 ${finalizedRound + 1} 轮，不能跳过轮次。`);
  }

  const entrants = (await loadMajorStageEntrantsInTx(tx, stageRun.id))
    .map((entrant) => ({ teamId: entrant.competitionEntryId, initialStageSeed: entrant.stageSeed }));
  const managedMatches = await tx.select().from(matches)
    .where(and(eq(matches.majorStageRunId, stageRun.id), eq(matches.ownership, "major_stage"))).for("update");

  const historical = managedMatches.filter((match) => match.round !== null && match.round <= finalizedRound)
    .map(completedFact);
  let expectedCurrent;
  try {
    expectedCurrent = generateNextMajorSwissRound({
      entrants,
      matches: historical,
      finalizedRound,
      stageMatchFormat: stage.matchFormat,
    });
  } catch (error) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, error instanceof Error ? `已确认比赛事实不合法：${error.message}` : "已确认比赛事实不合法。 ");
  }
  const currentMatches = managedMatches.filter((match) => match.round === input.expectedRound);
  if (currentMatches.length !== expectedCurrent.length) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `第 ${input.expectedRound} 轮托管比赛不完整，期望 ${expectedCurrent.length} 场，实际 ${currentMatches.length} 场。`);
  }
  const expectedByKey = new Map(expectedCurrent.map((pairing, index) => [
    pairKey(pairing.higherSeedTeamId, pairing.lowerSeedTeamId),
    { format: pairing.format, managedKey: `r${input.expectedRound}-${index + 1}` },
  ]));
  for (const match of currentMatches) {
    const expected = expectedByKey.get(pairKey(match.entryAId, match.entryBId));
    if (!expected || match.format !== expected.format || match.managedKey !== expected.managedKey) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `第 ${input.expectedRound} 轮存在不符合当前 Swiss 规则的托管比赛。`);
    }
  }
  const currentFacts = currentMatches.map(completedFact);
  const allFacts = [...historical, ...currentFacts];
  let projection;
  try {
    projection = projectMajorSwissStage({ entrants, matches: allFacts, finalizedRound: input.expectedRound });
  } catch (error) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, error instanceof Error ? `第 ${input.expectedRound} 轮结果不合法：${error.message}` : "本轮结果不合法。 ");
  }

  await tx.update(majorStageRuns).set({ finalizedRound: input.expectedRound }).where(eq(majorStageRuns.id, stageRun.id));
  let createdNextRound = 0;
  if (input.expectedRound < 5) {
    const nextRound = input.expectedRound + 1 as MajorSwissRound;
    let nextPairings;
    try {
      nextPairings = generateNextMajorSwissRound({
        entrants,
        matches: allFacts,
        finalizedRound: input.expectedRound,
        stageMatchFormat: stage.matchFormat,
      });
    } catch (error) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, error instanceof Error ? `不能生成下一轮：${error.message}` : "不能生成下一轮。 ");
    }
    const created = await tx.insert(matches).values(nextPairings.map((pairing, index) => ({
      seasonId: input.seasonId,
      entryAId: pairing.higherSeedTeamId,
      entryBId: pairing.lowerSeedTeamId,
      stage: stage.key,
      round: nextRound,
      format: pairing.format,
      status: "scheduled" as const,
      ownership: "major_stage" as const,
      majorStageRunId: stageRun.id,
      managedKey: `r${nextRound}-${index + 1}`,
    }))).returning({ id: matches.id });
    if (created.length !== nextPairings.length) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "下一轮托管比赛创建数量异常。 ");
    }
    createdNextRound = created.length;
  }
  await tx.insert(auditLogs).values({
    seasonId: input.seasonId,
    action: "major.swiss.finalize_round",
    actorId: input.actorId,
    targetId: stageRun.id,
    targetType: "major_stage_run",
    meta: {
      stageKey: stage.key,
      finalizedRound: input.expectedRound,
      completedMatches: currentFacts.length,
      createdNextRound,
      activeTeams: projection.active.length,
      advancedTeams: projection.advanced.length,
      eliminatedTeams: projection.eliminated.length,
    },
  });
  return {
    stageRunId: stageRun.id,
    finalizedRound: input.expectedRound,
    createdNextRound,
    stageComplete: input.expectedRound === 5,
    alreadyFinalized: false,
  };
}
