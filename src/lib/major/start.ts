import { and, count, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  majorPrestartEntrants,
  majorPrestartIssues,
  majorPrestartRosterMembers,
  majorPrestartStates,
  majorStageEntrants,
  majorStageRuns,
  majorTournamentSeeds,
  matches,
  seasons,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { buildMajorOpeningPlan } from "@/lib/major/opening";
import { evaluateMajorPrestartReadiness } from "@/lib/major/prestart";
import {
  checkStandardMajorCapabilities,
  normalizeRegistrationConfig,
  normalizeStagePlan,
  normalizeTeamRegistrationConfig,
} from "@/types/season";

const STAGE_ONE_MANAGED_MATCH_COUNT = 8;

export interface MajorStartResult {
  stageRunId: string;
  created: boolean;
  matchCount: number;
}

function capabilitiesFromSeason(season: typeof seasons.$inferSelect) {
  return {
    registrationMode: season.registrationMode,
    hasCaptainVoting: season.hasCaptainVoting,
    hasDraft: season.hasDraft,
    stagePlan: normalizeStagePlan(season.stagePlan),
    registrationConfig: normalizeRegistrationConfig(season.registrationConfig),
    teamRegistrationConfig: normalizeTeamRegistrationConfig(season.teamRegistrationConfig),
    minTeamSize: season.minTeamSize,
    maxTeamSize: season.maxTeamSize,
    starterCount: season.starterCount,
    positions: season.positions,
  };
}

/**
 * The persistence half of formally starting a Major. Call only inside the
 * Action's transaction: it locks the season first, so a retry can return the
 * one already-created Stage 1 run instead of making another opening round.
 */
export async function startMajorInTransaction(
  tx: TxDb,
  input: { seasonId: string; actorId: string },
): Promise<MajorStartResult> {
  const [season] = await tx.select().from(seasons)
    .where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");

  const capabilities = capabilitiesFromSeason(season);
  const standardMajor = checkStandardMajorCapabilities(capabilities);
  if (!standardMajor.isStandardMajor) {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前赛事不是标准 Major，不能正式开赛。");
  }
  const stage = capabilities.stagePlan[0];
  if (!stage || (stage.matchFormat !== "bo1" && stage.matchFormat !== "bo3")) {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "标准 Major 的阶段一赛制不可用于正式开赛。");
  }

  const [existingRun] = await tx.select({ id: majorStageRuns.id }).from(majorStageRuns)
    .where(and(eq(majorStageRuns.seasonId, season.id), eq(majorStageRuns.stageKey, stage.key))).for("update");
  if (existingRun) {
    const [{ value: entrantCount }] = await tx.select({ value: count() }).from(majorStageEntrants)
      .where(eq(majorStageEntrants.stageRunId, existingRun.id));
    const [{ value: matchCount }] = await tx.select({ value: count() }).from(matches)
      .where(and(eq(matches.majorStageRunId, existingRun.id), eq(matches.ownership, "major_stage")));
    if (season.status !== "playing" || Number(entrantCount) !== 16 || Number(matchCount) !== STAGE_ONE_MANAGED_MATCH_COUNT) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "已存在不完整的 Major Stage 1 运行记录，拒绝静默重建。");
    }
    return { stageRunId: existingRun.id, created: false, matchCount: Number(matchCount) };
  }
  if (season.status !== "registration") {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "Major 只能从报名阶段由管理员显式正式开赛。");
  }

  await tx.insert(majorPrestartStates).values({ seasonId: season.id }).onConflictDoNothing();
  const [state] = await tx.select().from(majorPrestartStates)
    .where(eq(majorPrestartStates.seasonId, season.id)).for("update");
  if (!state) throw new AppError(ErrorCode.INTERNAL_ERROR, "赛前状态初始化失败。");

  const entrantRows = await tx.select({
    id: majorPrestartEntrants.id,
    teamId: majorPrestartEntrants.teamId,
    rosterConfirmedAt: majorPrestartEntrants.rosterConfirmedAt,
  }).from(majorPrestartEntrants)
    .where(eq(majorPrestartEntrants.seasonId, season.id)).for("update");
  const entrantIds = entrantRows.map((entrant) => entrant.id);
  const rosterRows = entrantIds.length === 0 ? [] : await tx.select({
    entrantId: majorPrestartRosterMembers.entrantId,
    userId: majorPrestartRosterMembers.userId,
  }).from(majorPrestartRosterMembers)
    .where(inArray(majorPrestartRosterMembers.entrantId, entrantIds)).for("update");
  const issueRows = await tx.select({
    category: majorPrestartIssues.category,
    label: majorPrestartIssues.label,
    resolvedAt: majorPrestartIssues.resolvedAt,
  }).from(majorPrestartIssues)
    .where(eq(majorPrestartIssues.seasonId, season.id)).for("update");
  const seedRows = await tx.select({
    entrantId: majorTournamentSeeds.entrantId,
    tournamentSeed: majorTournamentSeeds.tournamentSeed,
  }).from(majorTournamentSeeds)
    .where(eq(majorTournamentSeeds.seasonId, season.id)).for("update");

  const rosterByEntrant = new Map<string, string[]>();
  for (const roster of rosterRows) {
    const members = rosterByEntrant.get(roster.entrantId) ?? [];
    members.push(roster.userId);
    rosterByEntrant.set(roster.entrantId, members);
  }
  const teamIdByEntrantId = new Map(entrantRows.map((entrant) => [entrant.id, entrant.teamId]));
  const seeds = seedRows.flatMap((seed) => {
    const teamId = teamIdByEntrantId.get(seed.entrantId);
    return teamId ? [{ teamId, tournamentSeed: seed.tournamentSeed }] : [];
  });
  const readiness = evaluateMajorPrestartReadiness({
    capabilities,
    teams: entrantRows.map((entrant) => ({
      teamId: entrant.teamId,
      playerIds: rosterByEntrant.get(entrant.id) ?? [],
    })),
    entrantsLocked: Boolean(state.entrantsLockedAt),
    confirmations: entrantRows.map((entrant) => ({ teamId: entrant.teamId, confirmed: Boolean(entrant.rosterConfirmedAt) })),
    qualificationIssues: issueRows.filter((issue) => issue.category === "qualification")
      .map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    administrativeIssues: issueRows.filter((issue) => issue.category === "administration")
      .map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    tournamentSeeds: seeds,
    seedConfirmation: { seedRevision: state.seedRevision, confirmedSeedRevision: state.confirmedSeedRevision },
  });
  if (!readiness.canStart || !readiness.openingPlan) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, readiness.blockers[0] ?? "Major 赛前检查未通过。");
  }
  if (state.seedsLockedAt) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事种子已经锁定，但 Stage 1 尚未形成；拒绝继续写入。");
  }

  const now = new Date();
  const openingPlan = buildMajorOpeningPlan({ teams: seeds, stageOneMatchFormat: stage.matchFormat });
  const entrantByTeamId = new Map(entrantRows.map((entrant) => [entrant.teamId, entrant]));
  const ruleSnapshot = {
    version: 1,
    stagePlan: capabilities.stagePlan.map((configuredStage) => ({
      key: configuredStage.key,
      name: configuredStage.name,
      type: configuredStage.type,
      teamCount: configuredStage.teamCount,
      matchFormat: configuredStage.matchFormat,
      finalFormat: configuredStage.finalFormat ?? null,
      advanceTiers: configuredStage.advanceTiers.map((tier) => ({ ...tier })),
      entrySeeds: configuredStage.entrySeeds ?? null,
      seeds: configuredStage.seeds ? [...configuredStage.seeds] : null,
    })),
    stage: {
      key: stage.key,
      name: stage.name,
      type: stage.type,
      teamCount: stage.teamCount,
      matchFormat: stage.matchFormat,
      finalFormat: stage.finalFormat ?? null,
      advanceTiers: stage.advanceTiers,
      entrySeeds: stage.entrySeeds ?? null,
      seeds: stage.seeds ? [...stage.seeds] : null,
    },
    rosterRules: {
      minTeamSize: season.minTeamSize,
      maxTeamSize: season.maxTeamSize,
      starterCount: season.starterCount,
    },
    tournamentEntrants: openingPlan.tournamentTeams.map((team) => {
      const entrant = entrantByTeamId.get(team.teamId);
      if (!entrant) throw new AppError(ErrorCode.INTERNAL_ERROR, "赛事种子缺少已锁定的正式参赛队。");
      return { entrantId: entrant.id, teamId: team.teamId, tournamentSeed: team.tournamentSeed };
    }),
    tournamentSeeds: openingPlan.tournamentTeams.map((team) => ({ ...team })),
    openingPairings: openingPlan.firstRound.pairings.map((pairing) => ({
      key: `r1-${pairing.higherSeed.stageOneSeed}`,
      teamAId: pairing.higherSeed.teamId,
      teamBId: pairing.lowerSeed.teamId,
      format: pairing.format,
      pairingRule: pairing.pairingRule,
    })),
  };
  const [stageRun] = await tx.insert(majorStageRuns).values({
    seasonId: season.id,
    stageKey: stage.key,
    ruleSnapshot,
    startedAt: now,
    startedBy: input.actorId,
  }).returning({ id: majorStageRuns.id });
  if (!stageRun) throw new AppError(ErrorCode.INTERNAL_ERROR, "Stage 1 运行记录创建失败。");

  await tx.insert(majorStageEntrants).values(openingPlan.stage1.entrants.map((team) => {
    const entrant = entrantByTeamId.get(team.teamId);
    if (!entrant) throw new AppError(ErrorCode.INTERNAL_ERROR, "Stage 1 入口缺少已锁定的正式参赛队。");
    return {
      stageRunId: stageRun.id,
      entrantId: entrant.id,
      teamId: team.teamId,
      tournamentSeed: team.tournamentSeed,
      stageSeed: team.initialStageSeed,
    };
  }));
  const createdMatches = await tx.insert(matches).values(openingPlan.firstRound.pairings.map((pairing, index) => ({
    seasonId: season.id,
    teamAId: pairing.higherSeed.teamId,
    teamBId: pairing.lowerSeed.teamId,
    stage: stage.key,
    round: 1,
    format: pairing.format,
    status: "scheduled" as const,
    ownership: "major_stage" as const,
    majorStageRunId: stageRun.id,
    managedKey: `r1-${index + 1}`,
  }))).returning({ id: matches.id });
  if (createdMatches.length !== STAGE_ONE_MANAGED_MATCH_COUNT) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Stage 1 首轮比赛创建数量异常。");
  }

  await tx.update(majorPrestartStates).set({
    entrantsLockedAt: state.entrantsLockedAt ?? now,
    entrantsLockedBy: state.entrantsLockedBy ?? input.actorId,
    seedsLockedAt: now,
    seedsLockedBy: input.actorId,
    updatedAt: now,
  }).where(eq(majorPrestartStates.id, state.id));
  await tx.update(seasons).set({ status: "playing", updatedAt: now }).where(eq(seasons.id, season.id));
  await tx.insert(auditLogs).values({
    seasonId: season.id,
    action: "major.start",
    actorId: input.actorId,
    targetId: stageRun.id,
    targetType: "major_stage_run",
    meta: {
      stageKey: stage.key,
      lockedEntrants: 32,
      lockedRosters: 32,
      lockedTournamentSeeds: 32,
      stageEntrants: 16,
      managedMatches: createdMatches.length,
    },
  });
  return { stageRunId: stageRun.id, created: true, matchCount: createdMatches.length };
}
