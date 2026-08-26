import { and, asc, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, majorFinalResults, majorStageEntrants, majorStageRuns, matches } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { validateSeriesScore } from "@/lib/matches/result-rules";
import { buildFinalMajorPlacements } from "@/lib/major/placement";
import { generateMajorPlayoffQuarterfinals, projectMajorPlayoff, seedMajorPlayoffEntrants, type MajorPlayoffMatchFact, type MajorPlayoffRound } from "@/lib/major/playoff";
import { getMajorSwissQualifiers, projectMajorSwissStage, type MajorSwissMatchFact } from "@/lib/major/swiss";

type FrozenStage = { key: string; name: string; type: string; teamCount: number; matchFormat: string; finalFormat: string | null };
type FrozenTournamentEntrant = { entrantId: string; teamId: string; tournamentSeed: number };
type FrozenSnapshot = { stagePlan: FrozenStage[]; stage: FrozenStage; tournamentEntrants: FrozenTournamentEntrant[]; hasThirdPlaceMatch?: boolean };
type PlayoffStep = "quarterfinal" | "semifinal" | "final";

export interface MajorPlayoffStartResult {
  sourceStageRunId: string;
  stageRunId: string;
  created: boolean;
  matchCount: number;
}

export interface MajorPlayoffFinalizationResult {
  stageRunId: string;
  finalizedRound: PlayoffStep;
  createdNextRound: number;
  resultPendingConfirmation: boolean;
  alreadyFinalized: boolean;
}

function snapshot(value: unknown): FrozenSnapshot {
  if (typeof value !== "object" || value === null) throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少规则快照。");
  const parsed = value as Partial<FrozenSnapshot>;
  if (!Array.isArray(parsed.stagePlan) || !parsed.stage || !Array.isArray(parsed.tournamentEntrants)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少冻结的赛事阶段或入口。");
  }
  const validStage = (stage: unknown): stage is FrozenStage => typeof stage === "object" && stage !== null &&
    typeof (stage as FrozenStage).key === "string" && typeof (stage as FrozenStage).name === "string" &&
    typeof (stage as FrozenStage).type === "string" && Number.isInteger((stage as FrozenStage).teamCount) &&
    typeof (stage as FrozenStage).matchFormat === "string" &&
    ((stage as FrozenStage).finalFormat === null || typeof (stage as FrozenStage).finalFormat === "string");
  if (!validStage(parsed.stage) || !parsed.stagePlan.every(validStage)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的阶段规则不可用。");
  }
  const ids = new Set<string>();
  const teamIds = new Set<string>();
  const seeds = new Set<number>();
  for (const entrant of parsed.tournamentEntrants) {
    if (!entrant || typeof entrant.entrantId !== "string" || typeof entrant.teamId !== "string" || !Number.isInteger(entrant.tournamentSeed) ||
      entrant.tournamentSeed < 1 || entrant.tournamentSeed > 32 || ids.has(entrant.entrantId) || teamIds.has(entrant.teamId) || seeds.has(entrant.tournamentSeed)) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的赛事入口不可用。");
    }
    ids.add(entrant.entrantId); teamIds.add(entrant.teamId); seeds.add(entrant.tournamentSeed);
  }
  if (ids.size !== 32) throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的入口数量不是 32 队。");
  return parsed as FrozenSnapshot;
}

function swissFact(match: typeof matches.$inferSelect): MajorSwissMatchFact {
  if (match.round === null || match.round < 1 || match.round > 5 || match.status !== "finished" || match.completedAt === null || match.scoreA === null || match.scoreB === null) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Swiss StageRun 含未完成或无正式比分的托管比赛。");
  }
  try { validateSeriesScore(match.format, match.scoreA, match.scoreB); } catch {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Swiss StageRun 含非法正式比分。");
  }
  return { matchId: match.id, round: match.round as 1 | 2 | 3 | 4 | 5, teamAId: match.teamAId, teamBId: match.teamBId, winnerId: match.scoreA > match.scoreB ? match.teamAId : match.teamBId };
}

function playoffFact(match: typeof matches.$inferSelect): MajorPlayoffMatchFact {
  if (match.entryRound !== "quarterfinal" && match.entryRound !== "semifinal" && match.entryRound !== "third_place" && match.entryRound !== "final") {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "托管淘汰赛比赛缺少有效轮次身份。");
  }
  if (match.status !== "finished" || match.completedAt === null || match.scoreA === null || match.scoreB === null) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "淘汰赛轮次仍有未完成或无正式比分的比赛。");
  }
  try { validateSeriesScore(match.format, match.scoreA, match.scoreB); } catch {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "淘汰赛轮次含非法正式比分。");
  }
  const slot = Number(match.managedKey?.split("-").at(-1));
  if (!Number.isInteger(slot) || slot < 1) throw new AppError(ErrorCode.INTERNAL_ERROR, "托管淘汰赛比赛缺少稳定槽位。");
  return { matchId: match.id, round: match.entryRound as MajorPlayoffRound, slot, teamAId: match.teamAId, teamBId: match.teamBId, winnerId: match.scoreA > match.scoreB ? match.teamAId : match.teamBId };
}

function samePair(match: typeof matches.$inferSelect, teamAId: string, teamBId: string): boolean {
  return (match.teamAId === teamAId && match.teamBId === teamBId) || (match.teamAId === teamBId && match.teamBId === teamAId);
}

function validateStageThree(snapshotValue: FrozenSnapshot, stageRun: typeof majorStageRuns.$inferSelect): FrozenStage {
  if (snapshotValue.stage.key !== stageRun.stageKey || snapshotValue.stage.type !== "swiss" || stageRun.finalizedRound !== 5) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有已确认完成的 Stage 3 Swiss StageRun 可以生成淘汰赛。");
  }
  const index = snapshotValue.stagePlan.findIndex((stage) => stage.key === stageRun.stageKey);
  const playoff = snapshotValue.stagePlan[index + 1];
  if (!playoff || playoff.type !== "single_elim" || playoff.teamCount !== 8 || playoff.matchFormat !== "bo3" || playoff.finalFormat !== "bo5") {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "冻结的 Major Stage 3 后未配置可运行的标准淘汰赛。");
  }
  return playoff;
}

/** Creates only the QF facts; later rounds are created after their upstream result is finalized. */
export async function startMajorPlayoffInTransaction(
  tx: TxDb,
  input: { seasonId: string; sourceStageRunId: string; actorId: string },
): Promise<MajorPlayoffStartResult> {
  const [sourceRun] = await tx.select().from(majorStageRuns)
    .where(and(eq(majorStageRuns.id, input.sourceStageRunId), eq(majorStageRuns.seasonId, input.seasonId))).for("update");
  if (!sourceRun) throw new AppError(ErrorCode.NOT_FOUND, "指定的 Stage 3 StageRun 不属于当前赛事。");
  const sourceSnapshot = snapshot(sourceRun.ruleSnapshot);
  const playoffStage = validateStageThree(sourceSnapshot, sourceRun);
  const [existingRun] = await tx.select().from(majorStageRuns)
    .where(and(eq(majorStageRuns.seasonId, input.seasonId), eq(majorStageRuns.stageKey, playoffStage.key))).for("update");
  if (existingRun) {
    const existing = await tx.select({ id: matches.id }).from(matches)
      .where(and(eq(matches.majorStageRunId, existingRun.id), eq(matches.ownership, "major_stage"), eq(matches.entryRound, "quarterfinal"))).for("update");
    if (existing.length !== 4) throw new AppError(ErrorCode.INTERNAL_ERROR, "淘汰赛 StageRun 已存在但八强赛不完整，拒绝静默重建。");
    return { sourceStageRunId: sourceRun.id, stageRunId: existingRun.id, created: false, matchCount: 4 };
  }
  const sourceEntrants = await tx.select().from(majorStageEntrants).where(eq(majorStageEntrants.stageRunId, sourceRun.id)).for("update");
  const sourceMatches = await tx.select().from(matches)
    .where(and(eq(matches.majorStageRunId, sourceRun.id), eq(matches.ownership, "major_stage"))).for("update");
  const stageThree = projectMajorSwissStage({
    entrants: sourceEntrants.map((entrant) => ({ teamId: entrant.teamId, initialStageSeed: entrant.stageSeed })),
    matches: sourceMatches.map(swissFact), finalizedRound: 5,
  });
  const playoffEntrants = seedMajorPlayoffEntrants(getMajorSwissQualifiers(stageThree));
  const frozenEntrantByTeam = new Map(sourceSnapshot.tournamentEntrants.map((entrant) => [entrant.teamId, entrant]));
  const [playoffRun] = await tx.insert(majorStageRuns).values({
    seasonId: input.seasonId, stageKey: playoffStage.key, startedBy: input.actorId,
    ruleSnapshot: { ...sourceSnapshot, stage: playoffStage, hasThirdPlaceMatch: false },
  }).returning({ id: majorStageRuns.id });
  if (!playoffRun) throw new AppError(ErrorCode.INTERNAL_ERROR, "淘汰赛 StageRun 创建失败。");
  await tx.insert(majorStageEntrants).values(playoffEntrants.map((entrant) => {
    const frozen = frozenEntrantByTeam.get(entrant.teamId);
    if (!frozen) throw new AppError(ErrorCode.INTERNAL_ERROR, "淘汰赛入口不属于冻结的 32 队赛事事实。");
    return { stageRunId: playoffRun.id, entrantId: frozen.entrantId, teamId: entrant.teamId, tournamentSeed: frozen.tournamentSeed, stageSeed: entrant.playoffSeed };
  }));
  const quarterfinals = generateMajorPlayoffQuarterfinals(playoffEntrants);
  const created = await tx.insert(matches).values(quarterfinals.map((pairing) => ({
    seasonId: input.seasonId, teamAId: pairing.higherSeedTeamId, teamBId: pairing.lowerSeedTeamId,
    stage: playoffStage.key, round: null, entryRound: "quarterfinal", format: playoffStage.matchFormat as "bo3", status: "scheduled" as const,
    ownership: "major_stage" as const, majorStageRunId: playoffRun.id, managedKey: `qf-${pairing.slot}`,
  }))).returning({ id: matches.id });
  if (created.length !== 4) throw new AppError(ErrorCode.INTERNAL_ERROR, "淘汰赛八强赛创建数量异常。");
  await tx.insert(auditLogs).values({ seasonId: input.seasonId, action: "major.playoff.start", actorId: input.actorId, targetId: playoffRun.id, targetType: "major_stage_run", meta: { sourceStageRunId: sourceRun.id, stageKey: playoffStage.key, entrants: 8, managedMatches: 4, hasThirdPlaceMatch: false } });
  return { sourceStageRunId: sourceRun.id, stageRunId: playoffRun.id, created: true, matchCount: created.length };
}

function expectedMatches(managed: readonly (typeof matches.$inferSelect)[], round: PlayoffStep, expectedCount: number): readonly (typeof matches.$inferSelect)[] {
  const rows = managed.filter((match) => match.entryRound === round);
  if (rows.length !== expectedCount) throw new AppError(ErrorCode.VALIDATION_FAILED, `${round} 托管比赛不完整。`);
  return rows.sort((a, b) => a.managedKey!.localeCompare(b.managedKey!));
}

async function completeSwissFactsForFinalPlacement(tx: TxDb, seasonId: string, sourceSnapshot: FrozenSnapshot) {
  const swissKeys = sourceSnapshot.stagePlan.filter((stage) => stage.type === "swiss").map((stage) => stage.key);
  if (swissKeys.length !== 3) throw new AppError(ErrorCode.INTERNAL_ERROR, "冻结的 Major 规则没有三个 Swiss Stage。 ");
  const runs = await tx.select().from(majorStageRuns).where(and(eq(majorStageRuns.seasonId, seasonId), inArray(majorStageRuns.stageKey, swissKeys))).orderBy(asc(majorStageRuns.stageKey)).for("update");
  if (runs.length !== 3 || runs.some((run) => run.finalizedRound !== 5)) throw new AppError(ErrorCode.INTERNAL_ERROR, "最终名次缺少完整的三个 Swiss StageRun。 ");
  const runByStageKey = new Map(runs.map((run) => [run.stageKey, run]));
  const runIds = runs.map((run) => run.id);
  const [entrantRows, matchRows] = await Promise.all([
    tx.select().from(majorStageEntrants).where(inArray(majorStageEntrants.stageRunId, runIds)).for("update"),
    tx.select().from(matches).where(and(inArray(matches.majorStageRunId, runIds), eq(matches.ownership, "major_stage"))).for("update"),
  ]);
  const factsFor = (key: string) => {
    const run = runByStageKey.get(key);
    if (!run) throw new AppError(ErrorCode.INTERNAL_ERROR, "最终名次缺少指定 Swiss StageRun。 ");
    return {
      entrants: entrantRows.filter((entrant) => entrant.stageRunId === run.id).map((entrant) => ({ teamId: entrant.teamId, initialStageSeed: entrant.stageSeed })),
      matches: matchRows.filter((match) => match.majorStageRunId === run.id).map(swissFact),
    };
  };
  return { stage1: factsFor(swissKeys[0]!), stage2: factsFor(swissKeys[1]!), stage3: factsFor(swissKeys[2]!) };
}

export async function finalizeMajorPlayoffRoundInTransaction(
  tx: TxDb,
  input: { seasonId: string; stageRunId: string; expectedRound: PlayoffStep; actorId: string },
): Promise<MajorPlayoffFinalizationResult> {
  const [run] = await tx.select().from(majorStageRuns)
    .where(and(eq(majorStageRuns.id, input.stageRunId), eq(majorStageRuns.seasonId, input.seasonId))).for("update");
  if (!run) throw new AppError(ErrorCode.NOT_FOUND, "指定的淘汰赛 StageRun 不属于当前赛事。");
  const frozen = snapshot(run.ruleSnapshot);
  if (frozen.stage.key !== run.stageKey || frozen.stage.type !== "single_elim" || frozen.stage.teamCount !== 8 || frozen.stage.matchFormat !== "bo3" || frozen.stage.finalFormat !== "bo5" || frozen.hasThirdPlaceMatch !== false) {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前 StageRun 不是可运行的无季军赛 Major 淘汰赛。 ");
  }
  const entrants = await tx.select().from(majorStageEntrants).where(eq(majorStageEntrants.stageRunId, run.id)).for("update");
  const managed = await tx.select().from(matches).where(and(eq(matches.majorStageRunId, run.id), eq(matches.ownership, "major_stage"))).for("update");
  const seeded = seedMajorPlayoffEntrants(entrants.map((entrant) => ({ teamId: entrant.teamId, finalStageSeed: entrant.stageSeed })));
  const qfs = expectedMatches(managed, "quarterfinal", 4);
  const expectedQfs = generateMajorPlayoffQuarterfinals(seeded);
  for (const pairing of expectedQfs) {
    const match = qfs[pairing.slot - 1];
    if (!match || !samePair(match, pairing.higherSeedTeamId, pairing.lowerSeedTeamId) || match.managedKey !== `qf-${pairing.slot}` || match.format !== "bo3") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "八强赛托管事实与冻结的淘汰赛种子不一致。 ");
    }
  }
  if (input.expectedRound === "quarterfinal") {
    const existingSemifinals = managed.filter((match) => match.entryRound === "semifinal");
    if (existingSemifinals.length > 0) return { stageRunId: run.id, finalizedRound: "quarterfinal", createdNextRound: 0, resultPendingConfirmation: false, alreadyFinalized: true };
    const qfFacts = qfs.map(playoffFact);
    const created = await tx.insert(matches).values([
      { seasonId: input.seasonId, teamAId: qfFacts[0]!.winnerId, teamBId: qfFacts[1]!.winnerId, stage: run.stageKey, entryRound: "semifinal", format: "bo3", status: "scheduled" as const, ownership: "major_stage" as const, majorStageRunId: run.id, managedKey: "sf-1" },
      { seasonId: input.seasonId, teamAId: qfFacts[2]!.winnerId, teamBId: qfFacts[3]!.winnerId, stage: run.stageKey, entryRound: "semifinal", format: "bo3", status: "scheduled" as const, ownership: "major_stage" as const, majorStageRunId: run.id, managedKey: "sf-2" },
    ]).returning({ id: matches.id });
    if (created.length !== 2) throw new AppError(ErrorCode.INTERNAL_ERROR, "半决赛创建数量异常。 ");
    await tx.insert(auditLogs).values({ seasonId: input.seasonId, action: "major.playoff.finalize_round", actorId: input.actorId, targetId: run.id, targetType: "major_stage_run", meta: { finalizedRound: "quarterfinal", createdNextRound: 2 } });
    return { stageRunId: run.id, finalizedRound: "quarterfinal", createdNextRound: 2, resultPendingConfirmation: false, alreadyFinalized: false };
  }
  const semifinals = expectedMatches(managed, "semifinal", 2);
  const qfFacts = qfs.map(playoffFact);
  for (const [index, semifinal] of semifinals.entries()) {
    if (!samePair(semifinal, qfFacts[index * 2]!.winnerId, qfFacts[index * 2 + 1]!.winnerId) || semifinal.managedKey !== `sf-${index + 1}` || semifinal.format !== "bo3") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "半决赛托管事实与八强赛胜者不一致。 ");
    }
  }
  if (input.expectedRound === "semifinal") {
    const existingFinal = managed.filter((match) => match.entryRound === "final");
    if (existingFinal.length > 0) return { stageRunId: run.id, finalizedRound: "semifinal", createdNextRound: 0, resultPendingConfirmation: false, alreadyFinalized: true };
    const sfFacts = semifinals.map(playoffFact);
    const [created] = await tx.insert(matches).values({ seasonId: input.seasonId, teamAId: sfFacts[0]!.winnerId, teamBId: sfFacts[1]!.winnerId, stage: run.stageKey, entryRound: "final", format: "bo5", status: "scheduled", ownership: "major_stage", majorStageRunId: run.id, managedKey: "final-1" }).returning({ id: matches.id });
    if (!created) throw new AppError(ErrorCode.INTERNAL_ERROR, "总决赛创建失败。 ");
    await tx.insert(auditLogs).values({ seasonId: input.seasonId, action: "major.playoff.finalize_round", actorId: input.actorId, targetId: run.id, targetType: "major_stage_run", meta: { finalizedRound: "semifinal", createdNextRound: 1 } });
    return { stageRunId: run.id, finalizedRound: "semifinal", createdNextRound: 1, resultPendingConfirmation: false, alreadyFinalized: false };
  }
  const existingResult = await tx.select().from(majorFinalResults).where(eq(majorFinalResults.playoffStageRunId, run.id)).for("update");
  if (existingResult[0]) return { stageRunId: run.id, finalizedRound: "final", createdNextRound: 0, resultPendingConfirmation: true, alreadyFinalized: true };
  const final = expectedMatches(managed, "final", 1)[0]!;
  const playoffFacts = [...qfs, ...semifinals, final].map(playoffFact);
  const playoff = projectMajorPlayoff({ entrants: seeded, matches: playoffFacts, hasThirdPlaceMatch: false });
  const swiss = await completeSwissFactsForFinalPlacement(tx, input.seasonId, frozen);
  const placements = buildFinalMajorPlacements({ tournamentTeams: frozen.tournamentEntrants.map(({ teamId, tournamentSeed }) => ({ teamId, tournamentSeed })), ...swiss, playoffMatches: playoffFacts, hasThirdPlaceMatch: false });
  const [result] = await tx.insert(majorFinalResults).values({ seasonId: input.seasonId, playoffStageRunId: run.id, championTeamId: playoff.championId, placementGroups: placements, status: "pending_confirmation", finalizedBy: input.actorId }).returning({ id: majorFinalResults.id });
  if (!result) throw new AppError(ErrorCode.INTERNAL_ERROR, "正式最终名次创建失败。 ");
  await tx.insert(auditLogs).values([
    { seasonId: input.seasonId, action: "major.playoff.finalize_round", actorId: input.actorId, targetId: run.id, targetType: "major_stage_run", meta: { finalizedRound: "final", createdNextRound: 0 } },
    { seasonId: input.seasonId, action: "major.result.pending_confirmation", actorId: input.actorId, targetId: result.id, targetType: "major_final_result", meta: { playoffStageRunId: run.id, championTeamId: playoff.championId, placementGroupCount: placements.length, hasThirdPlaceMatch: false } },
  ]);
  return { stageRunId: run.id, finalizedRound: "final", createdNextRound: 0, resultPendingConfirmation: true, alreadyFinalized: false };
}
