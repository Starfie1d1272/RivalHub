import { and, eq } from "drizzle-orm";
import { writeAuditInTx } from "@/lib/audit/write";

import type { TxDb } from "@/db/client";
import { majorStageEntrants, majorStageRuns, matches } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { validateSeriesScore } from "@/lib/matches/result-rules";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { directSeedRange, seedMajorLaterStageEntrants } from "@/lib/major/seeding";
import { makeMajorRunSnapshotV4, parseMajorRunSnapshot } from "@/lib/major/run-snapshot";
import { loadMajorStageEntrantsInTx, loadMajorTournamentEntrantsInTx } from "@/lib/major/run-entrants";
import { majorAppError } from "@/lib/major/errors";
import {
  generateNextMajorSwissRound,
  getMajorSwissQualifiers,
  projectMajorSwissStage,
  type MajorSwissMatchFact,
} from "@/lib/major/swiss";

type FrozenStage = {
  key: string;
  name: string;
  type: string;
  teamCount: number;
  matchFormat: string;
  entrySeeds?: number | null;
  advanceTiers: unknown[];
  finalFormat: string | null;
  seeds?: number[] | null;
};
type FrozenSwissStage = FrozenStage & { type: "swiss"; teamCount: 16; matchFormat: "bo1" | "bo3" };

export interface MajorStageTransitionResult {
  sourceStageRunId: string;
  stageRunId: string;
  stageKey: string;
  created: boolean;
  matchCount: number;
}

function completedFact(match: typeof matches.$inferSelect): MajorSwissMatchFact {
  if (match.round === null || match.round < 1 || match.round > 5 || match.status !== "finished" ||
    match.completedAt === null || match.scoreA === null || match.scoreB === null) {
    throw majorAppError(ErrorCode.VALIDATION_FAILED, "incompleteSwissResults");
  }
  try { validateSeriesScore(match.format, match.scoreA, match.scoreB); } catch {
    throw majorAppError(ErrorCode.VALIDATION_FAILED, "invalidSwissResults");
  }
  return {
    matchId: match.id,
    round: match.round as 1 | 2 | 3 | 4 | 5,
    entryAId: match.entryAId,
    entryBId: match.entryBId,
    winnerId: match.scoreA > match.scoreB ? match.entryAId : match.entryBId,
  };
}


/**
 * Materialize a later Swiss stage only from frozen StageRun facts. The source
 * run is the lock and identity boundary; this never asks which StageRun is
 * "currently" active for a season.
 */
export async function transitionMajorSwissStageInTransaction(
  tx: TxDb,
  input: { seasonId: string; sourceStageRunId: string; actorId: string },
): Promise<MajorStageTransitionResult> {
  await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
  const [sourceRun] = await tx.select().from(majorStageRuns)
    .where(and(eq(majorStageRuns.id, input.sourceStageRunId), eq(majorStageRuns.seasonId, input.seasonId))).for("update");
  if (!sourceRun) throw majorAppError(ErrorCode.NOT_FOUND, "sourceStageNotFound");
  if (sourceRun.finalizedRound !== 5) {
    throw majorAppError(ErrorCode.SEASON_INVALID_STATUS, "sourceStageIncomplete");
  }
  const sourceSnapshot = parseMajorRunSnapshot(sourceRun.ruleSnapshot, sourceRun.stageKey);
  if (sourceSnapshot.stage.key !== sourceRun.stageKey) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "源 StageRun 的阶段快照与记录不一致。");
  }
  const sourceIndex = sourceSnapshot.stagePlan.findIndex((stage) => stage.key === sourceRun.stageKey);
  const nextStage = sourceSnapshot.stagePlan[sourceIndex + 1];
  if (sourceIndex < 0 || !nextStage || nextStage.type !== "swiss" || nextStage.teamCount !== 16 ||
    (nextStage.matchFormat !== "bo1" && nextStage.matchFormat !== "bo3")) {
    throw majorAppError(ErrorCode.SEASON_INVALID_STATUS, "nextStageUnavailable");
  }
  const nextSwissStage = nextStage as FrozenSwissStage;

  const [existingRun] = await tx.select().from(majorStageRuns)
    .where(and(eq(majorStageRuns.seasonId, input.seasonId), eq(majorStageRuns.stageKey, nextSwissStage.key))).for("update");
  if (existingRun) {
    const existingMatches = await tx.select({ id: matches.id }).from(matches)
      .where(and(eq(matches.majorStageRunId, existingRun.id), eq(matches.ownership, "major_stage"))).for("update");
    if (existingMatches.length !== 8) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "下一 StageRun 已存在但首轮托管比赛不完整，拒绝静默重建。");
    }
    return { sourceStageRunId: sourceRun.id, stageRunId: existingRun.id, stageKey: nextSwissStage.key, created: false, matchCount: 8 };
  }

  const sourceEntrants = await loadMajorStageEntrantsInTx(tx, sourceRun.id);
  const sourceMatches = await tx.select().from(matches)
    .where(and(eq(matches.majorStageRunId, sourceRun.id), eq(matches.ownership, "major_stage"))).for("update");
  const projection = projectMajorSwissStage({
    entrants: sourceEntrants.map((entrant) => ({ teamId: entrant.competitionEntryId, initialStageSeed: entrant.stageSeed })),
    matches: sourceMatches.map(completedFact),
    finalizedRound: 5,
  });
  const qualifiers = getMajorSwissQualifiers(projection);
  if (qualifiers.length !== 8) throw new AppError(ErrorCode.INTERNAL_ERROR, "源 Swiss StageRun 没有形成恰好八支晋级队。");

  const directCount = nextSwissStage.entrySeeds;
  if (directCount !== 8) {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "后续 Major Swiss 阶段必须明确配置八支直入队。");
  }
  const [fromSeed, toSeed] = directSeedRange(sourceSnapshot.stagePlan, nextSwissStage.key, directCount);
  const tournamentEntrants = await loadMajorTournamentEntrantsInTx(tx, input.seasonId);
  const directEntrants = tournamentEntrants
    .filter((entrant) => entrant.tournamentSeed >= fromSeed && entrant.tournamentSeed <= toSeed)
    .map((entrant) => ({ teamId: entrant.competitionEntryId, tournamentSeed: entrant.tournamentSeed }));
  const seededEntrants = seedMajorLaterStageEntrants({
    directEntrants,
    advancingEntrants: qualifiers.map((qualifier) => ({ teamId: qualifier.teamId, previousStageFinalSeed: qualifier.finalStageSeed })),
  });
  const entrantByTeamId = new Map(tournamentEntrants.map((entrant) => [entrant.competitionEntryId, entrant]));
  const firstRound = generateNextMajorSwissRound({ entrants: seededEntrants, matches: [], finalizedRound: 0, stageMatchFormat: nextSwissStage.matchFormat });
  const now = new Date();
  const [stageRun] = await tx.insert(majorStageRuns).values({
    seasonId: input.seasonId,
    stageKey: nextSwissStage.key,
    startedAt: now,
    startedBy: input.actorId,
    ruleSnapshot: makeMajorRunSnapshotV4({ ...sourceSnapshot, hasThirdPlaceMatch: sourceSnapshot.hasThirdPlaceMatch }),
  }).returning({ id: majorStageRuns.id });
  if (!stageRun) throw new AppError(ErrorCode.INTERNAL_ERROR, "下一 StageRun 创建失败。");
  await tx.insert(majorStageEntrants).values(seededEntrants.map((entrant) => {
    const frozenEntrant = entrantByTeamId.get(entrant.teamId);
    if (!frozenEntrant) throw new AppError(ErrorCode.INTERNAL_ERROR, "下一 StageRun 的队伍不在冻结的 32 队入口中。");
    return {
      stageRunId: stageRun.id,
      seasonId: input.seasonId,
      tournamentEntrantId: frozenEntrant.entrantId,
      stageSeed: entrant.initialStageSeed,
    };
  }));
  const createdMatches = await tx.insert(matches).values(firstRound.map((pairing, index) => ({
    seasonId: input.seasonId,
    entryAId: pairing.higherSeedTeamId,
    entryBId: pairing.lowerSeedTeamId,
    stage: nextSwissStage.key,
    round: 1,
    format: pairing.format,
    status: "scheduled" as const,
    ownership: "major_stage" as const,
    majorStageRunId: stageRun.id,
    managedKey: `r1-${index + 1}`,
  }))).returning({ id: matches.id });
  if (createdMatches.length !== 8) throw new AppError(ErrorCode.INTERNAL_ERROR, "下一 StageRun 首轮比赛创建数量异常。");
  await writeAuditInTx(tx, {
    seasonId: input.seasonId,
    action: "major.stage.transition",
    actorId: input.actorId,
    targetId: stageRun.id,meta: { sourceStageRunId: sourceRun.id, sourceStageKey: sourceRun.stageKey, stageKey: nextSwissStage.key, directEntrants: directCount, advancingEntrants: qualifiers.length, managedMatches: createdMatches.length },
  });
  return { sourceStageRunId: sourceRun.id, stageRunId: stageRun.id, stageKey: nextSwissStage.key, created: true, matchCount: createdMatches.length };
}
