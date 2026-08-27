import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, majorStageEntrants, majorStageRuns, matches } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { validateSeriesScore } from "@/lib/matches/result-rules";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { seedMajorLaterStageEntrants } from "@/lib/major/seeding";
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
  entrySeeds: number | null;
  advanceTiers: unknown[];
  finalFormat: string | null;
  seeds: number[] | null;
};
type FrozenSwissStage = FrozenStage & { type: "swiss"; teamCount: 16; matchFormat: "bo1" | "bo3" };

type FrozenTournamentEntrant = { entrantId: string; teamId: string; tournamentSeed: number };
type FrozenSnapshot = {
  version: number;
  stagePlan: FrozenStage[];
  stage: FrozenSwissStage;
  tournamentEntrants: FrozenTournamentEntrant[];
};

export interface MajorStageTransitionResult {
  sourceStageRunId: string;
  stageRunId: string;
  stageKey: string;
  created: boolean;
  matchCount: number;
}

function frozenSnapshot(value: unknown): FrozenSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少规则快照。");
  }
  const snapshot = value as Partial<FrozenSnapshot>;
  if (!Array.isArray(snapshot.stagePlan) || !Array.isArray(snapshot.tournamentEntrants) || !snapshot.stage) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少可审计的赛事阶段或入口快照。");
  }
  const validStage = (stage: unknown): stage is FrozenStage => {
    if (typeof stage !== "object" || stage === null) return false;
    const candidate = stage as Partial<FrozenSwissStage>;
    return typeof candidate.key === "string" && typeof candidate.name === "string" &&
      typeof candidate.type === "string" && Number.isInteger(candidate.teamCount) &&
      typeof candidate.matchFormat === "string" &&
      (candidate.entrySeeds === null || typeof candidate.entrySeeds === "number") &&
      Array.isArray(candidate.advanceTiers) &&
      (candidate.finalFormat === null || typeof candidate.finalFormat === "string") &&
      (candidate.seeds === null || (Array.isArray(candidate.seeds) && candidate.seeds.every(Number.isInteger)));
  };
  const isSwissStage = (stage: FrozenStage): stage is FrozenSwissStage =>
    stage.type === "swiss" && stage.teamCount === 16 && (stage.matchFormat === "bo1" || stage.matchFormat === "bo3");
  if (!validStage(snapshot.stage) || !isSwissStage(snapshot.stage) || !snapshot.stagePlan.every(validStage)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的 Swiss 规则不可用。");
  }
  const entrantIds = new Set<string>();
  const teamIds = new Set<string>();
  const tournamentSeeds = new Set<number>();
  for (const entrant of snapshot.tournamentEntrants) {
    if (!entrant || typeof entrant.entrantId !== "string" || typeof entrant.teamId !== "string" ||
      !Number.isInteger(entrant.tournamentSeed) || entrant.tournamentSeed < 1 || entrant.tournamentSeed > 32 ||
      entrantIds.has(entrant.entrantId) || teamIds.has(entrant.teamId) || tournamentSeeds.has(entrant.tournamentSeed)) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的 32 队入口不可用。");
    }
    entrantIds.add(entrant.entrantId);
    teamIds.add(entrant.teamId);
    tournamentSeeds.add(entrant.tournamentSeed);
  }
  if (entrantIds.size !== 32) throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的入口数量不是 32 队。");
  return snapshot as FrozenSnapshot;
}

function completedFact(match: typeof matches.$inferSelect): MajorSwissMatchFact {
  if (match.round === null || match.round < 1 || match.round > 5 || match.status !== "finished" ||
    match.completedAt === null || match.scoreA === null || match.scoreB === null) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "已确认 StageRun 含未完成或无正式比分的托管比赛。");
  }
  try { validateSeriesScore(match.format, match.scoreA, match.scoreB); } catch {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "已确认 StageRun 含非法正式比分。");
  }
  return {
    matchId: match.id,
    round: match.round as 1 | 2 | 3 | 4 | 5,
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    winnerId: match.scoreA > match.scoreB ? match.teamAId : match.teamBId,
  };
}

function directSeedRange(stages: readonly FrozenStage[], targetIndex: number, count: number): readonly [number, number] {
  const laterDirectCount = stages.slice(targetIndex + 1)
    .filter((stage) => stage.type === "swiss")
    .reduce((sum, stage) => sum + (stage.entrySeeds ?? 0), 0);
  return [laterDirectCount + 1, laterDirectCount + count];
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
  if (!sourceRun) throw new AppError(ErrorCode.NOT_FOUND, "指定的源 StageRun 不属于当前赛事。");
  if (sourceRun.finalizedRound !== 5) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有已确认全部五轮的 Swiss StageRun 才能切换阶段。");
  }
  const sourceSnapshot = frozenSnapshot(sourceRun.ruleSnapshot);
  if (sourceSnapshot.stage.key !== sourceRun.stageKey) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "源 StageRun 的阶段快照与记录不一致。");
  }
  const sourceIndex = sourceSnapshot.stagePlan.findIndex((stage) => stage.key === sourceRun.stageKey);
  const nextStage = sourceSnapshot.stagePlan[sourceIndex + 1];
  if (sourceIndex < 0 || !nextStage || nextStage.type !== "swiss" || nextStage.teamCount !== 16 ||
    (nextStage.matchFormat !== "bo1" && nextStage.matchFormat !== "bo3")) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前 Swiss StageRun 后没有可切换的 Swiss 阶段。");
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

  const sourceEntrants = await tx.select({
    entrantId: majorStageEntrants.entrantId,
    teamId: majorStageEntrants.teamId,
    stageSeed: majorStageEntrants.stageSeed,
  }).from(majorStageEntrants).where(eq(majorStageEntrants.stageRunId, sourceRun.id)).for("update");
  const sourceMatches = await tx.select().from(matches)
    .where(and(eq(matches.majorStageRunId, sourceRun.id), eq(matches.ownership, "major_stage"))).for("update");
  const projection = projectMajorSwissStage({
    entrants: sourceEntrants.map((entrant) => ({ teamId: entrant.teamId, initialStageSeed: entrant.stageSeed })),
    matches: sourceMatches.map(completedFact),
    finalizedRound: 5,
  });
  const qualifiers = getMajorSwissQualifiers(projection);
  if (qualifiers.length !== 8) throw new AppError(ErrorCode.INTERNAL_ERROR, "源 Swiss StageRun 没有形成恰好八支晋级队。");

  const directCount = nextSwissStage.entrySeeds;
  if (directCount !== 8) {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "后续 Major Swiss 阶段必须明确配置八支直入队。");
  }
  const [fromSeed, toSeed] = directSeedRange(sourceSnapshot.stagePlan, sourceIndex + 1, directCount);
  const directEntrants = sourceSnapshot.tournamentEntrants
    .filter((entrant) => entrant.tournamentSeed >= fromSeed && entrant.tournamentSeed <= toSeed)
    .map((entrant) => ({ teamId: entrant.teamId, tournamentSeed: entrant.tournamentSeed }));
  const seededEntrants = seedMajorLaterStageEntrants({
    directEntrants,
    advancingEntrants: qualifiers.map((qualifier) => ({ teamId: qualifier.teamId, previousStageFinalSeed: qualifier.finalStageSeed })),
  });
  const entrantByTeamId = new Map(sourceSnapshot.tournamentEntrants.map((entrant) => [entrant.teamId, entrant]));
  const firstRound = generateNextMajorSwissRound({ entrants: seededEntrants, matches: [], finalizedRound: 0, stageMatchFormat: nextSwissStage.matchFormat });
  const now = new Date();
  const [stageRun] = await tx.insert(majorStageRuns).values({
    seasonId: input.seasonId,
    stageKey: nextSwissStage.key,
    startedAt: now,
    startedBy: input.actorId,
    ruleSnapshot: {
      ...sourceSnapshot,
      stage: nextSwissStage,
      openingPairings: firstRound.map((pairing, index) => ({
        key: `r1-${index + 1}`,
        teamAId: pairing.higherSeedTeamId,
        teamBId: pairing.lowerSeedTeamId,
        format: pairing.format,
        pairingRule: pairing.pairingRule,
      })),
    },
  }).returning({ id: majorStageRuns.id });
  if (!stageRun) throw new AppError(ErrorCode.INTERNAL_ERROR, "下一 StageRun 创建失败。");
  await tx.insert(majorStageEntrants).values(seededEntrants.map((entrant) => {
    const frozenEntrant = entrantByTeamId.get(entrant.teamId);
    if (!frozenEntrant) throw new AppError(ErrorCode.INTERNAL_ERROR, "下一 StageRun 的队伍不在冻结的 32 队入口中。");
    return {
      stageRunId: stageRun.id,
      entrantId: frozenEntrant.entrantId,
      teamId: entrant.teamId,
      tournamentSeed: frozenEntrant.tournamentSeed,
      stageSeed: entrant.initialStageSeed,
    };
  }));
  const createdMatches = await tx.insert(matches).values(firstRound.map((pairing, index) => ({
    seasonId: input.seasonId,
    teamAId: pairing.higherSeedTeamId,
    teamBId: pairing.lowerSeedTeamId,
    stage: nextSwissStage.key,
    round: 1,
    format: pairing.format,
    status: "scheduled" as const,
    ownership: "major_stage" as const,
    majorStageRunId: stageRun.id,
    managedKey: `r1-${index + 1}`,
  }))).returning({ id: matches.id });
  if (createdMatches.length !== 8) throw new AppError(ErrorCode.INTERNAL_ERROR, "下一 StageRun 首轮比赛创建数量异常。");
  await tx.insert(auditLogs).values({
    seasonId: input.seasonId,
    action: "major.stage.transition",
    actorId: input.actorId,
    targetId: stageRun.id,
    targetType: "major_stage_run",
    meta: { sourceStageRunId: sourceRun.id, sourceStageKey: sourceRun.stageKey, stageKey: nextSwissStage.key, directEntrants: directCount, advancingEntrants: qualifiers.length, managedMatches: createdMatches.length },
  });
  return { sourceStageRunId: sourceRun.id, stageRunId: stageRun.id, stageKey: nextSwissStage.key, created: true, matchCount: createdMatches.length };
}
