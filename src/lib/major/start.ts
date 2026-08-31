import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  eventRosterMembers,
  eventRosters,
  majorTournamentEntrants,
  majorPrestartIssues,
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
import { assertPrestartEntryCoherenceInTx } from "@/lib/major/prestart-entry";
import { ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";
import { freezeAffiliationRules } from "@/lib/major/frozen-affiliation-rules";
import { makeMajorRunSnapshotV4 } from "@/lib/major/run-snapshot";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { checkStandardMajorCapabilities } from "@/lib/competition/definition";
import {
  evaluateRosterQualificationFromFacts,
  loadParticipantQualificationFacts,
  resolveCompetitiveContext,
  type ParticipantQualificationFacts,
} from "@/lib/qualification/service";
import {
  normalizeRegistrationConfig,
  normalizeStagePlan,
  normalizeTeamRegistrationConfig,
  normalizeAffiliationRules,
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
    affiliationRules: normalizeAffiliationRules(season.affiliationRules),
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
  await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
  const [season] = await tx.select().from(seasons)
    .where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  if (season.competitionTemplate !== "major") {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前赛事不是 Major 赛事模板，不能正式开赛。");
  }

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

  const state = await ensureMajorPrestartStateInTx(tx, season.id);

  // 先只读 entrant refs；Entry/eventRoster 的行锁由 coherence guard 以
  // canonical 顺序（Entry → eventRoster）获取，之后才锁 entrants，避免
  // entrant → Entry 的锁顺序反转与 roster change 形成死锁窗口。prestart
  // state 行锁已在上方串行化所有 prestart 管理 mutation，锁定期间 entrant
  // 集合不可能漂移；仍显式校验，一旦漂移按 invariant fail closed。
  const entrantRefs = await tx.select({
    id: majorTournamentEntrants.id,
    seasonId: majorTournamentEntrants.seasonId,
    competitionEntryId: majorTournamentEntrants.competitionEntryId,
  }).from(majorTournamentEntrants)
    .where(eq(majorTournamentEntrants.seasonId, season.id)).orderBy(asc(majorTournamentEntrants.id));
  // Fail closed before freezing anything when an entrant's registration fact
  // and its prestart event roster have drifted (reopened remediation, stale
  // approved revision, or a broken roster binding).
  const coherenceRows = await assertPrestartEntryCoherenceInTx(
    tx,
    season.id,
    entrantRefs.map((entrant) => ({ competitionEntryId: entrant.competitionEntryId })),
  );
  const entryNameByEntryId = new Map(coherenceRows.map((row) => [row.entry.id, row.entry.name]));
  const entrantRows = await tx.select({
    id: majorTournamentEntrants.id,
    seasonId: majorTournamentEntrants.seasonId,
    competitionEntryId: majorTournamentEntrants.competitionEntryId,
  }).from(majorTournamentEntrants)
    .where(eq(majorTournamentEntrants.seasonId, season.id)).orderBy(asc(majorTournamentEntrants.id)).for("update");
  const refById = new Map(entrantRefs.map((ref) => [ref.id, ref]));
  if (entrantRows.length !== entrantRefs.length || entrantRows.some((entrant) => {
    const ref = refById.get(entrant.id);
    return !ref || ref.seasonId !== entrant.seasonId || ref.competitionEntryId !== entrant.competitionEntryId;
  })) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "赛前参赛队集合在开赛校验期间发生变化，拒绝继续开赛。");
  }
  const eventRosterIds = coherenceRows.map((row) => row.eventRoster.id);
  const rosterRows = eventRosterIds.length === 0 ? [] : await tx.select({
    eventRosterId: eventRosterMembers.eventRosterId,
    userId: eventRosterMembers.userId,
    educationVerificationId: eventRosterMembers.educationVerificationId,
    isPrimaryStarter: eventRosterMembers.isPrimaryStarter,
  }).from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .where(and(inArray(eventRosterMembers.eventRosterId, eventRosterIds), eq(eventRosters.status, "frozen"))).for("update");
  const issueRows = await tx.select({
    category: majorPrestartIssues.category,
    label: majorPrestartIssues.label,
    resolvedAt: majorPrestartIssues.resolvedAt,
  }).from(majorPrestartIssues)
    .where(eq(majorPrestartIssues.seasonId, season.id)).for("update");
  const seedRows = await tx.select({
    entrantId: majorTournamentSeeds.tournamentEntrantId,
    tournamentSeed: majorTournamentSeeds.seed,
  }).from(majorTournamentSeeds)
    .where(eq(majorTournamentSeeds.seasonId, season.id)).for("update");

  const rosterByEventRoster = new Map<string, Array<{ userId: string; educationVerificationId: string | null }>>();
  for (const roster of rosterRows) {
    const members = rosterByEventRoster.get(roster.eventRosterId) ?? [];
    members.push({ userId: roster.userId, educationVerificationId: roster.educationVerificationId });
    rosterByEventRoster.set(roster.eventRosterId, members);
  }
  const entryIdByEntrantId = new Map(entrantRows.map((entrant) => [entrant.id, entrant.competitionEntryId]));
  const seeds = seedRows.flatMap((seed) => {
    const entryId = entryIdByEntrantId.get(seed.entrantId);
    return entryId ? [{ teamId: entryId, tournamentSeed: seed.tournamentSeed }] : [];
  });
  const readiness = evaluateMajorPrestartReadiness({
    competitionTemplate: season.competitionTemplate,
    capabilities,
    teams: entrantRows.map((entrant) => {
      const roster = rosterByEventRoster.get(coherenceRows.find((row) => row.entry.id === entrant.competitionEntryId)?.eventRoster.id ?? "") ?? [];
      return {
        teamId: entrant.competitionEntryId,
        playerIds: roster.map((member) => member.userId),
        educationVerificationIds: roster.map((member) => member.educationVerificationId),
      };
    }),
    entrantsLocked: Boolean(state.entrantsLockedAt),
    confirmations: entrantRows.map((entrant) => ({ teamId: entrant.competitionEntryId, confirmed: coherenceRows.find((row) => row.entry.id === entrant.competitionEntryId)?.eventRoster.status === "frozen" })),
    qualificationIssues: issueRows.filter((issue) => issue.category === "qualification")
      .map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    administrativeIssues: issueRows.filter((issue) => issue.category === "administration")
      .map((issue) => ({ label: issue.label, resolved: Boolean(issue.resolvedAt) })),
    tournamentSeeds: seeds,
    seedConfirmation: { confirmed: state.seedsConfirmedAt !== null && state.seedsConfirmedBy !== null },
  });
  if (!readiness.canStart || !readiness.openingPlan) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, readiness.blockers[0] ?? "Major 赛前检查未通过。");
  }
  if (state.seedsLockedAt) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事种子已经锁定，但 Stage 1 尚未形成；拒绝继续写入。");
  }

  const now = new Date();
  const openingPlan = buildMajorOpeningPlan({ teams: seeds, stageOneMatchFormat: stage.matchFormat });
  const entrantByEntryId = new Map(entrantRows.map((entrant) => [entrant.competitionEntryId, entrant]));
  const requiresCompetitiveProfile = capabilities.teamRegistrationConfig.requireCompetitiveProfile;
  const configuredCompetitiveProfile = capabilities.teamRegistrationConfig.competitiveProfile ?? null;
  const competitiveProfile = configuredCompetitiveProfile
    ? await resolveCompetitiveContext(configuredCompetitiveProfile)
    : null;
  if (requiresCompetitiveProfile && !competitiveProfile) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "本届赛事要求竞技资料，但发布时冻结的竞技平台目录不完整，不能正式开赛。");
  }
  const affiliationRules = capabilities.affiliationRules;
  const frozenParticipantIds = [...new Set(rosterRows.map((row) => row.userId))];

  // Start-time qualification: live participant facts may still change between
  // approval and start, so the event's frozen competitive context is
  // re-evaluated against the exact batch of facts that is about to be frozen.
  // One batched load feeds both the qualification decision and the
  // frozenCompetitiveFacts snapshot — never two different reads.
  const needsQualificationLoad = (competitiveProfile !== null || affiliationRules.length > 0) && frozenParticipantIds.length > 0;
  const qualificationFacts: ReadonlyMap<string, ParticipantQualificationFacts> = needsQualificationLoad
    ? await loadParticipantQualificationFacts(frozenParticipantIds, {
        executor: tx,
        platform: competitiveProfile
          ? competitiveProfile.platform
          : undefined,
      })
    : new Map<string, ParticipantQualificationFacts>();
  const membersByEventRoster = new Map<string, Array<{ userId: string; isPrimaryStarter: boolean }>>();
  for (const row of rosterRows) {
    const members = membersByEventRoster.get(row.eventRosterId) ?? [];
    members.push({ userId: row.userId, isPrimaryStarter: row.isPrimaryStarter });
    membersByEventRoster.set(row.eventRosterId, members);
  }
  const qualificationBlockers: string[] = [];
  for (const entrant of entrantRows) {
    const rosterMembers = membersByEventRoster.get(coherenceRows.find((row) => row.entry.id === entrant.competitionEntryId)?.eventRoster.id ?? "") ?? [];
    if (rosterMembers.length === 0) continue; // readiness already blocks empty/absent frozen rosters.
    const qualification = await evaluateRosterQualificationFromFacts({
      members: rosterMembers.map((member) => {
        const fact = qualificationFacts.get(member.userId);
        return {
          userId: member.userId,
          email: fact?.email ?? "",
          emailVerifiedAt: fact?.emailVerifiedAt ?? null,
          educationHistory: fact?.educationHistory ?? [],
        };
      }),
      facts: qualificationFacts,
      affiliationRules,
      competitiveProfile,
      primaryStarterUserIds: rosterMembers.filter((member) => member.isPrimaryStarter).map((member) => member.userId),
    });
    if (!qualification.eligible) {
      qualificationBlockers.push(`参赛条目「${entryNameByEntryId.get(entrant.competitionEntryId) ?? entrant.competitionEntryId}」：${qualification.blockers.join(" ")}`);
    }
  }
  if (qualificationBlockers.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, qualificationBlockers.join(" "));
  }
  const frozenCompetitiveFacts = frozenParticipantIds.map((userId) => {
    const fact = qualificationFacts.get(userId);
    const serialize = (peak: { rank: string; rating: number } | null) => (peak ? { rank: peak.rank, rating: peak.rating } : null);
    return {
      userId,
      historicalPeak: competitiveProfile ? serialize(fact?.historicalPeak ?? null) : null,
      previousSeasonPeak: competitiveProfile
        ? serialize(fact?.seasonPeaks?.get(competitiveProfile.previousSeasonKey) ?? null)
        : null,
      currentSeasonPeak: competitiveProfile
        ? serialize(fact?.seasonPeaks?.get(competitiveProfile.currentSeasonKey) ?? null)
        : null,
    };
  });
  const ruleSnapshot = makeMajorRunSnapshotV4({
    // StageRun is the immutable tournament rule owner. Match-roster (G1)
    // must consume this frozen value rather than seasons.affiliationRules.
    stagePlan: capabilities.stagePlan.map((configuredStage) => ({
      key: configuredStage.key,
      name: configuredStage.name,
      type: configuredStage.type,
      teamCount: configuredStage.teamCount,
      matchFormat: configuredStage.matchFormat!,
      finalFormat: configuredStage.finalFormat ?? null,
      advanceTiers: configuredStage.advanceTiers.map((tier) => ({ ...tier })),
      entrySeeds: configuredStage.entrySeeds ?? null,
      seeds: configuredStage.seeds ? [...configuredStage.seeds] : null,
    })),
    rosterRules: {
      minTeamSize: season.minTeamSize,
      maxTeamSize: season.maxTeamSize,
      starterCount: season.starterCount,
    },
    affiliationRules: freezeAffiliationRules(capabilities.affiliationRules),
    competitiveProfile,
    // Immutable participant-level historical / previous / current values.
    // Match lineup validation must never consult mutable rank facts again.
    frozenCompetitiveFacts,
  });
  const [stageRun] = await tx.insert(majorStageRuns).values({
    seasonId: season.id,
    stageKey: stage.key,
    ruleSnapshot,
    startedAt: now,
    startedBy: input.actorId,
  }).returning({ id: majorStageRuns.id });
  if (!stageRun) throw new AppError(ErrorCode.INTERNAL_ERROR, "Stage 1 运行记录创建失败。");

  await tx.insert(majorStageEntrants).values(openingPlan.stage1.entrants.map((team) => {
    const entrant = entrantByEntryId.get(team.teamId);
    if (!entrant) throw new AppError(ErrorCode.INTERNAL_ERROR, "Stage 1 入口缺少已锁定的正式参赛队。");
    return {
      stageRunId: stageRun.id,
      seasonId: season.id,
      tournamentEntrantId: entrant.id,
      stageSeed: team.initialStageSeed,
    };
  }));
  const createdMatches = await tx.insert(matches).values(openingPlan.firstRound.pairings.map((pairing, index) => ({
    seasonId: season.id,
    entryAId: pairing.higherSeed.teamId,
    entryBId: pairing.lowerSeed.teamId,
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
