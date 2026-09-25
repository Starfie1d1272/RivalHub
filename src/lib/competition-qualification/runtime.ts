import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  competitionEntries,
  competitionQualificationEntrants,
  competitionQualificationRuns,
  eventRosters,
  majorPrestartStates,
  majorStageRuns,
  majorTournamentEntrants,
  majorTournamentSeeds,
  matches,
  seasons,
} from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { projectSwissStage } from "@/lib/swiss/core";
import { pairSwissTopHalfBottomHalf } from "@/lib/swiss/pairing";
import type { SwissCompletedMatch, SwissEntrant, SwissTeamState } from "@/lib/swiss/types";
import { assertPrestartEntryCoherenceInTx, assertSinglePrestartEntryCoherenceInTx } from "@/lib/event-rosters/coherence";
import { syncApprovedRosterToEventRosterInTx } from "@/lib/event-rosters/owner";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import {
  deriveCompetitionQualificationPlan,
  isShortSwissQualificationAllowed,
  swapQualificationPreliminaryRank,
  type CompetitionQualificationFormat,
} from "./policy";
import { generateShortSwissRoundPairings, type QualificationPairing } from "./swiss";

type QualificationRun = typeof competitionQualificationRuns.$inferSelect;
type QualificationEntrant = typeof competitionQualificationEntrants.$inferSelect;

function toSwissTeamStates(entrants: readonly SwissEntrant[]): SwissTeamState[] {
  return entrants.map((entrant) => ({
    teamId: entrant.teamId,
    initialSeed: entrant.initialSeed,
    currentSeed: entrant.initialSeed,
    wins: 0,
    losses: 0,
    buchholz: 0,
    status: "active",
    opponents: [],
  }));
}

function playInSwissEntrants(entrants: readonly QualificationEntrant[], directEntryCount: number): SwissEntrant[] {
  return entrants.filter((entrant) => entrant.preliminarySeed > directEntryCount)
    .map((entrant) => ({ teamId: entrant.competitionEntryId, initialSeed: entrant.preliminarySeed - directEntryCount }));
}

function winnerFromMatch(match: typeof matches.$inferSelect): string {
  if (match.scoreA === null || match.scoreB === null || match.scoreA === match.scoreB) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, `Play-in 比赛 ${match.id} 缺少有效胜者。`);
  }
  return match.scoreA > match.scoreB ? match.entryAId : match.entryBId;
}

function swissFactsFromMatches(
  rows: readonly typeof matches.$inferSelect[],
  throughRound: number,
): SwissCompletedMatch[] {
  return rows.filter((match) => match.round !== null && match.round <= throughRound && match.status === "finished")
    .map((match) => ({
      matchId: match.id,
      round: match.round!,
      entryAId: match.entryAId,
      entryBId: match.entryBId,
      winnerId: winnerFromMatch(match),
    }));
}

function toPairingFacts(pairings: readonly QualificationPairing[]): Array<{ pairKey: string; pairing: QualificationPairing }> {
  return pairings.map((pairing) => ({
    pairKey: [pairing.higherSeedTeamId, pairing.lowerSeedTeamId].sort().join(":"),
    pairing,
  }));
}

function matchPairKey(match: typeof matches.$inferSelect): string {
  return [match.entryAId, match.entryBId].sort().join(":")
}

function validatePersistedRound(
  matchesInRound: readonly typeof matches.$inferSelect[],
  pairings: readonly QualificationPairing[],
  format: "bo1" | "bo3",
  runId: string,
): void {
  const expected = toPairingFacts(pairings);
  const actual = matchesInRound.map((match) => matchPairKey(match));
  if (actual.length !== expected.length || new Set(actual).size !== actual.length ||
      actual.some((key) => !expected.some((row) => row.pairKey === key)) ||
      matchesInRound.some((match) => match.round !== pairings[0]?.round || match.format !== format || match.stage !== "play-in" ||
        match.qualificationRunId !== runId || match.ownership !== "manual" || match.majorStageRunId !== null ||
        match.managedKey !== null || match.bracketNodeId !== null)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 已生成轮次与当前种子或规则不一致，拒绝继续。");
  }
}

async function createPairingRowsInTx(
  tx: TxDb,
  input: { seasonId: string; runId: string; actorId: string; pairings: readonly QualificationPairing[]; format: "bo1" | "bo3" },
) {
  if (input.pairings.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前没有可生成的 Play-in 对阵。");
  const values = input.pairings.map((pairing) => ({
    seasonId: input.seasonId,
    entryAId: pairing.higherSeedTeamId,
    entryBId: pairing.lowerSeedTeamId,
    stage: "play-in",
    round: pairing.round,
    format: input.format,
    status: "scheduled" as const,
    ownership: "manual" as const,
    qualificationRunId: input.runId,
    majorStageRunId: null,
    managedKey: null,
    bracketNodeId: null,
  }));
  const created = await tx.insert(matches).values(values).returning({ id: matches.id });
  await writeAuditInTx(tx, {
    seasonId: input.seasonId,
    action: "competition_qualification.generate_round",
    actorId: input.actorId,
    targetId: input.runId,
    meta: { round: input.pairings[0]!.round, matchCount: created.length, format: input.format },
  });
  return created;
}

async function loadRunEntrantsInTx(tx: TxDb, runId: string): Promise<QualificationEntrant[]> {
  return tx.select().from(competitionQualificationEntrants)
    .where(eq(competitionQualificationEntrants.runId, runId))
    .orderBy(asc(competitionQualificationEntrants.preliminarySeed));
}

async function loadRunMatchesInTx(tx: TxDb, runId: string) {
  return tx.select().from(matches).where(eq(matches.qualificationRunId, runId))
    .orderBy(asc(matches.round), asc(matches.id));
}

function assertCandidateSet(entrants: readonly QualificationEntrant[], expectedIds: readonly string[]): void {
  const entrantIds = entrants.map((entrant) => entrant.competitionEntryId);
  if (entrants.length !== expectedIds.length || new Set(expectedIds).size !== expectedIds.length ||
      expectedIds.some((id) => !entrantIds.includes(id))) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "报名候选队伍集合已变化，请刷新后重试。");
  }
  if (entrants.some((entrant, index) => entrant.preliminarySeed !== index + 1)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 预排名不连续，拒绝生成比赛。");
  }
}

function assertRunSnapshot(run: QualificationRun, entrants: readonly QualificationEntrant[]): void {
  assertCandidateSet(entrants, entrants.map((entrant) => entrant.competitionEntryId));
  const qualifierCount = run.candidateCount - run.targetEntrantCount;
  if (entrants.length !== run.candidateCount || qualifierCount < 1 ||
      run.directEntryCount !== run.targetEntrantCount - qualifierCount ||
      run.qualifierCount !== qualifierCount || run.playInEntryCount !== qualifierCount * 2 ||
      run.candidateCount !== run.directEntryCount + run.playInEntryCount ||
      (run.format === "short_swiss_2w2l" && !isShortSwissQualificationAllowed(run.playInEntryCount))) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 运行配置与冻结候选集合不一致。");
  }
}

function directBo3Pairings(entrants: readonly QualificationEntrant[], directEntryCount: number): QualificationPairing[] {
  return pairSwissTopHalfBottomHalf(toSwissTeamStates(playInSwissEntrants(entrants, directEntryCount))).map((pair) => ({
    round: 1,
    record: { wins: 0, losses: 0 },
    higherSeedTeamId: pair.higherSeedTeamId,
    lowerSeedTeamId: pair.lowerSeedTeamId,
    higherSeed: pair.higherSeed,
    lowerSeed: pair.lowerSeed,
  }));
}

function validateShortSwissHistory(
  run: QualificationRun,
  entrants: readonly QualificationEntrant[],
  linkedMatches: readonly typeof matches.$inferSelect[],
): { completedRound: number; projection: ReturnType<typeof projectSwissStage> } {
  const swissEntrants = playInSwissEntrants(entrants, run.directEntryCount);
  const rounds = new Map<number, typeof linkedMatches[number][]>();
  for (const match of linkedMatches) {
    if (match.round === null || match.round < 1 || match.round > 5) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Short Swiss Play-in 比赛轮次无效。");
    }
    const rows = rounds.get(match.round) ?? [];
    rows.push(match);
    rounds.set(match.round, rows);
  }
  const facts: SwissCompletedMatch[] = [];
  let completedRound = 0;
  let projection = projectSwissStage({ entrants: swissEntrants, matches: facts, completedRound, config: { winThreshold: 2, lossThreshold: 2 } });
  for (let round = 1; round <= 5; round += 1) {
    const rows = rounds.get(round) ?? [];
    if (rows.length === 0) break;
    const pairings = generateShortSwissRoundPairings({ entrants: swissEntrants, matches: facts, completedRound });
    validatePersistedRound(rows, pairings, "bo1", run.id);
    if (rows.some((match) => match.status !== "finished")) {
      if ([...rounds.keys()].some((futureRound) => futureRound > round)) {
        throw new AppError(ErrorCode.INTERNAL_ERROR, "前一轮未完成时已存在后续 Play-in 轮次。");
      }
      break;
    }
    facts.push(...swissFactsFromMatches(rows, round));
    completedRound = round;
    projection = projectSwissStage({ entrants: swissEntrants, matches: facts, completedRound, config: { winThreshold: 2, lossThreshold: 2 } });
  }
  if ([...rounds.keys()].some((round) => round > completedRound + 1)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Short Swiss Play-in 存在跳轮比赛。");
  }
  return { completedRound, projection };
}

export async function configureCompetitionQualificationRunInTx(
  tx: TxDb,
  input: {
    seasonId: string;
    actorId: string;
    format: CompetitionQualificationFormat;
    preliminaryOrderEntryIds: readonly string[];
  },
): Promise<{ seasonSlug: string; runId: string; directEntryCount: number; playInEntryCount: number; qualifierCount: number }> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const { entrantCapacity } = getStandardMajorDefinition(season);
  if (season.status !== "registration") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有报名阶段可以配置 Play-in。");
  if (!season.registrationClosesAt || season.registrationClosesAt.getTime() > Date.now()) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "报名截止前不能锁定 Play-in 候选队伍。");
  }
  const [existingRun] = await tx.select({ id: competitionQualificationRuns.id })
    .from(competitionQualificationRuns).where(eq(competitionQualificationRuns.seasonId, season.id));
  if (existingRun) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "本赛季 Play-in 已配置。");
  const [prestartState] = await tx.select().from(majorPrestartStates).where(eq(majorPrestartStates.seasonId, season.id));
  if (prestartState && (prestartState.entrantsLockedAt || prestartState.seedsConfirmedAt || prestartState.seedsLockedAt)) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "正赛赛前事实已经锁定，不能再配置 Play-in。");
  }
  const [dependencies] = await tx.select({ id: majorTournamentEntrants.id })
    .from(majorTournamentEntrants).where(eq(majorTournamentEntrants.seasonId, season.id)).limit(1);
  const [seed] = await tx.select({ id: majorTournamentSeeds.id })
    .from(majorTournamentSeeds).where(eq(majorTournamentSeeds.seasonId, season.id)).limit(1);
  const [stageRun] = await tx.select({ id: majorStageRuns.id })
    .from(majorStageRuns).where(eq(majorStageRuns.seasonId, season.id)).limit(1);
  if (dependencies || seed || stageRun) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "正赛已经产生依赖事实，不能再配置 Play-in。");

  const entries = await tx.select().from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.registrationStatus, "approved")))
    .orderBy(asc(competitionEntries.id)).for("update");
  if (entries.some((entry) => !entry.approvedRosterRevisionId)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "已批准报名缺少审核名单，不能配置 Play-in。");
  }
  const pending = await tx.select({ id: competitionEntries.id }).from(competitionEntries)
    .where(and(
      eq(competitionEntries.competitionId, season.id),
      inArray(competitionEntries.registrationStatus, ["submitted", "changes_requested", "waitlisted"]),
    )).limit(1);
  if (pending.length > 0) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "仍有报名审核或名单补正待处理，不能锁定 Play-in 候选队伍。");

  const plan = deriveCompetitionQualificationPlan(entries.length, entrantCapacity);
  if (input.format === "short_swiss_2w2l" && !isShortSwissQualificationAllowed(plan.playInEntryCount)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Short Swiss 需要 Play-in 队伍数为 4 的倍数。");
  }
  const ordered = input.preliminaryOrderEntryIds;
  if (ordered.length !== entries.length || new Set(ordered).size !== ordered.length ||
      entries.some((entry) => !ordered.includes(entry.id))) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "报名候选队伍集合已变化，请刷新后重试。");
  }
  const [run] = await tx.insert(competitionQualificationRuns).values({
    seasonId: season.id,
    format: input.format,
    ...plan,
    configuredBy: input.actorId,
  }).returning({ id: competitionQualificationRuns.id });
  if (!run) throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 配置保存失败。");
  await tx.insert(competitionQualificationEntrants).values(ordered.map((competitionEntryId, index) => ({
    runId: run.id,
    seasonId: season.id,
    competitionEntryId,
    preliminarySeed: index + 1,
  })));
  await writeAuditInTx(tx, {
    seasonId: season.id,
    action: "competition_qualification.configure",
    actorId: input.actorId,
    targetId: run.id,
    meta: { ...plan, format: input.format },
  });
  return {
    seasonSlug: season.slug,
    runId: run.id,
    directEntryCount: plan.directEntryCount,
    playInEntryCount: plan.playInEntryCount,
    qualifierCount: plan.qualifierCount,
  };
}

export async function saveCompetitionQualificationRankInTx(
  tx: TxDb,
  input: { seasonId: string; entryId: string; nextRank: number; actorId: string },
): Promise<{ seasonSlug: string }> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const [run] = await tx.select().from(competitionQualificationRuns)
    .where(eq(competitionQualificationRuns.seasonId, season.id)).for("update");
  if (!run) throw new AppError(ErrorCode.NOT_FOUND, "Play-in 尚未配置。");
  if (run.startedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "Play-in 开始后不能调整预排名。");
  const entrants = await loadRunEntrantsInTx(tx, run.id);
  const nextOrder = swapQualificationPreliminaryRank(
    entrants.map((entrant) => entrant.competitionEntryId),
    input.entryId,
    input.nextRank,
  );
  await tx.delete(competitionQualificationEntrants).where(eq(competitionQualificationEntrants.runId, run.id));
  await tx.insert(competitionQualificationEntrants).values(nextOrder.map((competitionEntryId, index) => ({
    runId: run.id,
    seasonId: season.id,
    competitionEntryId,
    preliminarySeed: index + 1,
  })));
  await writeAuditInTx(tx, {
    seasonId: season.id,
    action: "competition_qualification.rank",
    actorId: input.actorId,
    targetId: run.id,
    meta: { entryId: input.entryId, nextRank: input.nextRank },
  });
  return { seasonSlug: season.slug };
}

export async function resetCompetitionQualificationRunInTx(
  tx: TxDb,
  input: { seasonId: string; actorId: string },
): Promise<{ seasonSlug: string }> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const [run] = await tx.select().from(competitionQualificationRuns)
    .where(eq(competitionQualificationRuns.seasonId, season.id)).for("update");
  if (!run) throw new AppError(ErrorCode.NOT_FOUND, "Play-in 尚未配置。");
  const linkedMatches = await tx.select({ id: matches.id }).from(matches)
    .where(eq(matches.qualificationRunId, run.id)).limit(1);
  if (run.startedAt || linkedMatches.length > 0) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "Play-in 已开始或已生成比赛，不能重置。");
  }
  await tx.delete(competitionQualificationEntrants).where(eq(competitionQualificationEntrants.runId, run.id));
  await tx.delete(competitionQualificationRuns).where(eq(competitionQualificationRuns.id, run.id));
  await writeAuditInTx(tx, {
    seasonId: season.id,
    action: "competition_qualification.reset",
    actorId: input.actorId,
    targetId: run.id,
    meta: { format: run.format },
  });
  return { seasonSlug: season.slug };
}

export async function generateCompetitionQualificationRoundInTx(
  tx: TxDb,
  input: { seasonId: string; runId: string; actorId: string },
): Promise<{ seasonSlug: string; round: number; matchCount: number; created: boolean }> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const [run] = await tx.select().from(competitionQualificationRuns)
    .where(and(eq(competitionQualificationRuns.id, input.runId), eq(competitionQualificationRuns.seasonId, season.id))).for("update");
  if (!run) throw new AppError(ErrorCode.NOT_FOUND, "Play-in 运行记录不存在。");
  if (run.completedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "Play-in 已完成，没有待生成的轮次。");
  const entrants = await loadRunEntrantsInTx(tx, run.id);
  assertRunSnapshot(run, entrants);
  const swissEntrants = playInSwissEntrants(entrants, run.directEntryCount);
  if (swissEntrants.length !== run.playInEntryCount) throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 队伍数量与预排名切线不一致。");
  const existing = await loadRunMatchesInTx(tx, run.id);
  const grouped = new Map<number, typeof existing>();
  for (const match of existing) {
    if (match.round === null) throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 比赛缺少轮次。");
    const rows = grouped.get(match.round) ?? [];
    rows.push(match);
    grouped.set(match.round, rows);
  }

  if (run.format === "direct_bo3") {
    const pairings = directBo3Pairings(entrants, run.directEntryCount);
    const current = grouped.get(1) ?? [];
    if (current.length > 0) {
      validatePersistedRound(current, pairings, "bo3", run.id);
      if (existing.length !== current.length) throw new AppError(ErrorCode.INTERNAL_ERROR, "Direct BO3 Play-in 存在多余轮次。");
      return { seasonSlug: season.slug, round: 1, matchCount: current.length, created: false };
    }
    if (existing.length > 0 || run.startedAt) throw new AppError(ErrorCode.INTERNAL_ERROR, "Direct BO3 Play-in 生命周期数据不一致。");
    await materializePlayInRostersInTx(tx, season, run, entrants, input.actorId);
    const created = await createPairingRowsInTx(tx, { seasonId: season.id, runId: run.id, actorId: input.actorId, pairings, format: "bo3" });
    await tx.update(competitionQualificationRuns).set({ startedAt: new Date(), startedBy: input.actorId, updatedAt: new Date() }).where(eq(competitionQualificationRuns.id, run.id));
    return { seasonSlug: season.slug, round: 1, matchCount: created.length, created: true };
  }

  if (!isShortSwissQualificationAllowed(run.playInEntryCount)) throw new AppError(ErrorCode.INTERNAL_ERROR, "Short Swiss 队伍数不符合规则。");
  let completedRound = 0;
  let projectionMatches: SwissCompletedMatch[] = [];
  for (let round = 1; round <= 5; round += 1) {
    const roundMatches = grouped.get(round) ?? [];
    if (roundMatches.length === 0) break;
    const pairings = generateShortSwissRoundPairings({ entrants: swissEntrants, matches: projectionMatches, completedRound });
    const countForRound = roundMatches.length;
    if (round !== completedRound + 1) throw new AppError(ErrorCode.INTERNAL_ERROR, "Short Swiss Play-in 轮次不连续。");
    if (roundMatches.length !== pairings.length) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, `Short Swiss 第 ${round} 轮比赛集合不完整。`);
    }
    validatePersistedRound(roundMatches, pairings, "bo1", run.id);
    if (roundMatches.some((match) => match.status !== "finished")) {
      if ([...grouped.keys()].some((key) => key > round)) throw new AppError(ErrorCode.INTERNAL_ERROR, "前一轮未完成时已存在后续轮次。");
      return { seasonSlug: season.slug, round, matchCount: countForRound, created: false };
    }
    completedRound = round;
    projectionMatches = swissFactsFromMatches(existing, completedRound);
  }
  if (existing.some((match) => match.round! > completedRound + 1)) throw new AppError(ErrorCode.INTERNAL_ERROR, "Short Swiss Play-in 出现跳轮比赛。");
  const completeProjection = completedRound > 0
    ? projectSwissStage({ entrants: swissEntrants, matches: projectionMatches, completedRound, config: { winThreshold: 2, lossThreshold: 2 } })
    : null;
  if (completeProjection?.isComplete) {
    await tx.update(competitionQualificationRuns).set({ completedAt: new Date(), updatedAt: new Date() }).where(eq(competitionQualificationRuns.id, run.id));
    return { seasonSlug: season.slug, round: completedRound, matchCount: 0, created: false };
  }
  const nextRound = completedRound + 1;
  const pairings = generateShortSwissRoundPairings({ entrants: swissEntrants, matches: projectionMatches, completedRound });
  const alreadyPresent = grouped.get(nextRound) ?? [];
  if (alreadyPresent.length > 0) {
    validatePersistedRound(alreadyPresent, pairings, "bo1", run.id);
    return { seasonSlug: season.slug, round: nextRound, matchCount: alreadyPresent.length, created: false };
  }
  if (run.startedAt && completedRound === 0) throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 已标记开始但缺少第一轮比赛。");
  if (completedRound === 0) await materializePlayInRostersInTx(tx, season, run, entrants, input.actorId);
  const created = await createPairingRowsInTx(tx, { seasonId: season.id, runId: run.id, actorId: input.actorId, pairings, format: "bo1" });
  if (!run.startedAt) await tx.update(competitionQualificationRuns).set({ startedAt: new Date(), startedBy: input.actorId, updatedAt: new Date() }).where(eq(competitionQualificationRuns.id, run.id));
  return { seasonSlug: season.slug, round: nextRound, matchCount: created.length, created: true };
}

export async function completeCompetitionQualificationIfReadyInTx(
  tx: TxDb,
  runId: string,
): Promise<boolean> {
  const [run] = await tx.select().from(competitionQualificationRuns).where(eq(competitionQualificationRuns.id, runId)).for("update");
  if (!run || run.completedAt || !run.startedAt) return false;
  const linked = await loadRunMatchesInTx(tx, run.id);
  if (linked.some((match) => match.status === "cancelled")) return false;
  const entrants = await loadRunEntrantsInTx(tx, run.id);
  assertRunSnapshot(run, entrants);
  if (linked.length === 0) throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 已标记开始但缺少比赛。");
  let isComplete = false;
  if (run.format === "direct_bo3") {
    validatePersistedRound(linked, directBo3Pairings(entrants, run.directEntryCount), "bo3", run.id);
    isComplete = linked.length === run.qualifierCount && linked.every((match) => match.round === 1 && match.status === "finished");
  } else {
    const { projection } = validateShortSwissHistory(run, entrants, linked);
    isComplete = projection.isComplete && projection.advanced.length === run.qualifierCount;
  }
  if (!isComplete) return false;
  await tx.update(competitionQualificationRuns).set({ completedAt: new Date(), updatedAt: new Date() }).where(eq(competitionQualificationRuns.id, run.id));
  return true;
}

export async function getCompetitionQualificationFinalEntryIdsInTx(
  tx: TxDb,
  run: QualificationRun,
): Promise<string[]> {
  if (!run.completedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "Play-in 尚未完成，不能确认正赛参赛队。");
  const entrants = await loadRunEntrantsInTx(tx, run.id);
  assertRunSnapshot(run, entrants);
  const directIds = entrants.filter((entrant) => entrant.preliminarySeed <= run.directEntryCount)
    .map((entrant) => entrant.competitionEntryId);
  const linked = await loadRunMatchesInTx(tx, run.id);
  let qualifierIds: string[];
  if (run.format === "direct_bo3") {
    validatePersistedRound(linked, directBo3Pairings(entrants, run.directEntryCount), "bo3", run.id);
    if (linked.length !== run.qualifierCount || linked.some((match) => match.status !== "finished" || match.round !== 1)) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Direct BO3 结果与运行状态不一致。");
    }
    qualifierIds = linked.map(winnerFromMatch);
  } else {
    const { completedRound, projection } = validateShortSwissHistory(run, entrants, linked);
    if (!projection.isComplete || projection.advanced.length !== run.qualifierCount) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Short Swiss 晋级队伍数量与运行配置不一致。");
    }
    if (completedRound === 0 || linked.some((match) => match.status !== "finished")) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Short Swiss 仍有未完成比赛。");
    }
    qualifierIds = projection.advanced.map((team) => team.teamId);
  }
  const finalIds = [...directIds, ...qualifierIds];
  if (finalIds.length !== run.targetEntrantCount || new Set(finalIds).size !== finalIds.length) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 正赛参赛队集合不符合目标容量。");
  }
  return finalIds;
}

export async function reconcileQualificationEntryAfterApprovalInTx(
  tx: TxDb,
  input: { seasonId: string; entryId: string; actorId: string },
): Promise<boolean> {
  const [entrant] = await tx.select({ runId: competitionQualificationEntrants.runId, preliminarySeed: competitionQualificationEntrants.preliminarySeed }).from(competitionQualificationEntrants)
    .innerJoin(competitionQualificationRuns, eq(competitionQualificationRuns.id, competitionQualificationEntrants.runId))
    .where(and(eq(competitionQualificationEntrants.seasonId, input.seasonId), eq(competitionQualificationEntrants.competitionEntryId, input.entryId)));
  if (!entrant) return false;
  const [run] = await tx.select().from(competitionQualificationRuns)
    .where(eq(competitionQualificationRuns.id, entrant.runId)).for("update");
  if (!run) throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 运行记录不存在。");
  if (!run.startedAt || entrant.preliminarySeed <= run.directEntryCount) return false;
  const [activeMatch] = await tx.select({ id: matches.id }).from(matches).where(and(
    eq(matches.qualificationRunId, run.id),
    eq(matches.status, "in_progress"),
    eq(matches.entryAId, input.entryId),
  )).limit(1);
  const [activeAsB] = await tx.select({ id: matches.id }).from(matches).where(and(
    eq(matches.qualificationRunId, run.id),
    eq(matches.status, "in_progress"),
    eq(matches.entryBId, input.entryId),
  )).limit(1);
  if (activeMatch || activeAsB) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "比赛进行中时不能同步变更 Play-in 队伍名单。");
  const coherent = await assertSinglePrestartEntryCoherenceInTx(tx, input.seasonId, { competitionEntryId: input.entryId }, { requireEventRosterSync: false });
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId));
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  const result = await syncApprovedRosterToEventRosterInTx(tx, { season, coherent, actorId: input.actorId });
  if (result.changed) await writeAuditInTx(tx, {
    seasonId: input.seasonId,
    action: "competition_qualification.reconcile_roster",
    actorId: input.actorId,
    targetId: run.id,
    meta: { entryId: input.entryId, eventRosterId: result.eventRosterId, rosterSize: result.rosterSize },
  });
  return result.changed;
}

async function materializePlayInRostersInTx(
  tx: TxDb,
  season: typeof seasons.$inferSelect,
  run: QualificationRun,
  entrants: readonly QualificationEntrant[],
  actorId: string,
): Promise<void> {
  const playInEntryIds = entrants.filter((entrant) => entrant.preliminarySeed > run.directEntryCount)
    .map((entrant) => entrant.competitionEntryId);
  if (playInEntryIds.length !== run.playInEntryCount) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Play-in 候选队伍与预排名切线不一致。");
  }
  const entries = await tx.select().from(competitionEntries)
    .where(inArray(competitionEntries.id, playInEntryIds)).orderBy(asc(competitionEntries.id)).for("update");
  if (entries.length !== playInEntryIds.length || entries.some((entry) =>
    entry.competitionId !== season.id || entry.registrationStatus !== "approved" || !entry.approvedRosterRevisionId,
  )) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Play-in 队伍必须仍属于本赛事且报名审核通过。");
  }
  const existingRosters = await tx.select({ entryId: eventRosters.entryId }).from(eventRosters)
    .where(inArray(eventRosters.entryId, playInEntryIds)).for("update");
  const existingIds = new Set(existingRosters.map((row) => row.entryId));
  const missing = entries.filter((entry) => !existingIds.has(entry.id));
  if (missing.length > 0) await tx.insert(eventRosters).values(missing.map((entry) => ({
    entryId: entry.id,
    sourceRosterRevisionId: entry.approvedRosterRevisionId!,
    status: "preparing" as const,
  }))).onConflictDoNothing({ target: eventRosters.entryId });
  const coherent = await assertPrestartEntryCoherenceInTx(
    tx,
    season.id,
    playInEntryIds.map((competitionEntryId) => ({ competitionEntryId })),
    { requireEventRosterSync: false },
  );
  for (const row of coherent) {
    const result = await syncApprovedRosterToEventRosterInTx(tx, { season, coherent: row, actorId });
    if (result.changed) await writeAuditInTx(tx, {
      seasonId: season.id,
      action: "competition_qualification.sync_roster",
      actorId,
      targetId: run.id,
      meta: { entryId: row.entry.id, eventRosterId: result.eventRosterId, rosterSize: result.rosterSize },
    });
  }
}
