import { isMajorPrestartPhase } from "@/lib/major/formation-phase";
import { syncAutomaticPickEmInTx } from "@/lib/predictions/service";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { writeAuditInTx } from "@/lib/audit/write";

import type { TxDb } from "@/db/client";
import {
  eventRosterMembers,
  eventRosters,
  majorTournamentEntrants,
  majorPrestartStates,
  majorStageEntrants,
  majorStageRuns,
  majorTournamentSeeds,
  majorSeedRecommendationSnapshots,
  matches,
  seasons,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { buildMajorOpeningPlan } from "@/lib/major/opening";
import { evaluateMajorPrestartReadiness } from "@/lib/major/prestart";
import { assertPrestartEntryCoherenceInTx } from "@/lib/event-rosters/coherence";
import { ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";
import { freezeAffiliationRules } from "@/lib/major/frozen-affiliation-rules";
import { makeMajorRunSnapshotV4 } from "@/lib/major/run-snapshot";
import { decodeEventRosterEligibilitySnapshotV2 } from "@/lib/seasons/eligibility-snapshot";
import { decodeFrozenLineupEligibility } from "@/lib/match-rosters/frozen-eligibility";
import { evaluateLineup } from "@/lib/match-rosters/lineup";
import { loadActiveSanctionsInTx } from "@/lib/discipline/service";
import { decodeSeasonRules, seasonRulesNeedCompetitiveContext } from "@/lib/seasons/rules";
import { loadActiveRestrictionOverridesInTx, unresolvedQualificationFindings } from "@/lib/competition-entries/restriction-overrides";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { getDisplayName } from "@/lib/identity/display-name";
import {
  buildFrozenSetFingerprint,
  frozenTeamsForSnapshot,
  getSeedRecommendationSnapshotStatus,
} from "@/lib/major/seed-recommendation-snapshot";
import {
  evaluateRosterQualificationFromFacts,
  loadParticipantQualificationFacts,
  resolveCompetitiveContext,
  toPlayerStrengthInput,
  type ParticipantQualificationFacts,
} from "@/lib/qualification/service";

const STAGE_ONE_MANAGED_MATCH_COUNT = 8;

export interface MajorStartResult {
  stageRunId: string;
  created: boolean;
  matchCount: number;
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
  const { capabilities, entrantCapacity } = getStandardMajorDefinition(season, {
    notMajor: "当前赛事不是 Major 赛事模板，不能正式开赛。",
    notStandard: "当前赛事不是标准 Major，不能正式开赛。",
  });
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
  if (!isMajorPrestartPhase(season)) {
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
    eventRosterMemberId: eventRosterMembers.id,
    eventRosterId: eventRosterMembers.eventRosterId,
    userId: eventRosterMembers.userId,
    participantId: eventRosterMembers.participantId,
    educationVerificationId: eventRosterMembers.educationVerificationId,
    isPrimaryStarter: eventRosterMembers.isPrimaryStarter,
  }).from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .where(and(inArray(eventRosterMembers.eventRosterId, eventRosterIds), eq(eventRosters.status, "frozen"), eq(eventRosterMembers.isCurrent, true))).for("update");
  const seedRows = await tx.select({
    entrantId: majorTournamentSeeds.tournamentEntrantId,
    tournamentSeed: majorTournamentSeeds.seed,
  }).from(majorTournamentSeeds)
    .where(eq(majorTournamentSeeds.seasonId, season.id)).for("update");

  const rosterByEventRoster = new Map<string, Array<{ userId: string; participantId: string | null; educationVerificationId: string | null; isPrimaryStarter: boolean }>>();
  for (const roster of rosterRows) {
    const members = rosterByEventRoster.get(roster.eventRosterId) ?? [];
    members.push({ userId: roster.userId, participantId: roster.participantId, educationVerificationId: roster.educationVerificationId, isPrimaryStarter: roster.isPrimaryStarter });
    rosterByEventRoster.set(roster.eventRosterId, members);
  }
  const entryIdByEntrantId = new Map(entrantRows.map((entrant) => [entrant.id, entrant.competitionEntryId]));
  const seeds = seedRows.flatMap((seed) => {
    const entryId = entryIdByEntrantId.get(seed.entrantId);
    return entryId ? [{ teamId: entryId, tournamentSeed: seed.tournamentSeed }] : [];
  });
  const coherenceByEntryId = new Map(coherenceRows.map((row) => [row.entry.id, row]));
  const entrantIdByEventRosterId = new Map(
    entrantRows.map((entrant) => {
      const coherence = coherenceByEntryId.get(entrant.competitionEntryId);
      if (!coherence) throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队缺少一致性校验结果。");
      return [coherence.eventRoster.id, entrant.id] as const;
    }),
  );
  const frozenTeams = frozenTeamsForSnapshot(
    entrantRows.map((entrant) => {
      const coherence = coherenceByEntryId.get(entrant.competitionEntryId);
      if (!coherence) throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队缺少一致性校验结果。");
      return {
        id: entrant.id,
        teamId: entrant.competitionEntryId,
        eventRosterId: coherence.eventRoster.id,
        sourceRosterRevisionId: coherence.eventRoster.sourceRosterRevisionId,
        teamName: coherence.entry.name,
      };
    }),
    rosterRows.map((member) => {
      const entrantId = entrantIdByEventRosterId.get(member.eventRosterId);
      if (!entrantId) throw new AppError(ErrorCode.INTERNAL_ERROR, "冻结 EventRoster 缺少正式参赛队绑定。");
      return {
        entrantId,
        userId: member.userId,
        participantId: member.participantId,
        educationVerificationId: member.educationVerificationId,
        isPrimaryStarter: member.isPrimaryStarter,
      };
    }),
  );
  const frozenSetFingerprint = buildFrozenSetFingerprint(season.id, frozenTeams);
  const [snapshot] = await tx.select().from(majorSeedRecommendationSnapshots)
    .where(eq(majorSeedRecommendationSnapshots.seasonId, season.id)).for("update");
  const recommendationStatus = getSeedRecommendationSnapshotStatus({
    snapshot,
    seasonId: season.id,
    frozenSetFingerprint,
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
    tournamentSeeds: seeds,
    seedConfirmation: { confirmed: state.seedsConfirmedAt !== null && state.seedsConfirmedBy !== null },
    seedRecommendation: { status: recommendationStatus, manual: snapshot?.context.competitiveContext === null },
  });
  if (!readiness.canStart || !readiness.openingPlan) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, readiness.blockers[0] ?? "Major 赛前检查未通过。");
  }
  if (state.seedsLockedAt) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事种子已经锁定，但 Stage 1 尚未形成；拒绝继续写入。");
  }

  const now = new Date();
  const openingPlan = buildMajorOpeningPlan({ teams: seeds, stagePlan: capabilities.stagePlan });
  const entrantByEntryId = new Map(entrantRows.map((entrant) => [entrant.competitionEntryId, entrant]));
  const rules = decodeSeasonRules(season);
  const definitionPolicy = capabilities.teamRegistrationConfig.qualificationPolicy;
  const requiresCompetitiveProfile = definitionPolicy?.competitiveProfileRequired ?? ("requireCompetitiveProfile" in capabilities.teamRegistrationConfig && capabilities.teamRegistrationConfig.requireCompetitiveProfile);
  const needsContext = rules.source === "policy_v2" ? seasonRulesNeedCompetitiveContext(rules) : Boolean(requiresCompetitiveProfile || definitionPolicy?.externalStrengthGap.enabled);
  const configuredCompetitiveProfile = definitionPolicy ? needsContext ? definitionPolicy.competitiveProfile : null : "competitiveProfile" in capabilities.teamRegistrationConfig ? capabilities.teamRegistrationConfig.competitiveProfile ?? null : null;
  // V2 evidence requirements are evaluated per purpose; historical-only gaps
  // do not require the full current/previous season profile.
  const competitiveProfile = rules.source === "policy_v2" ? configuredCompetitiveProfile : configuredCompetitiveProfile
    ? await resolveCompetitiveContext(configuredCompetitiveProfile)
    : null;
  if (needsContext && !competitiveProfile) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "本届赛事要求竞技资料，但实际开放报名时冻结的竞技平台目录不完整，不能正式开赛。");
  }
  const affiliationRules = definitionPolicy?.version === 1 ? definitionPolicy.affiliationRules : capabilities.affiliationRules;
  const frozenParticipantIds = [...new Set(rosterRows.map((row) => row.userId))];

  // StageRun owns a copy of each adopted v2 eligibility snapshot. Verify the
  // immutable Entry/revision/member bindings before persisting the copy.
  const frozenEligibilitySnapshots = definitionPolicy?.version === 2
    ? coherenceRows.map((coherence) => {
      const adopted = decodeEventRosterEligibilitySnapshotV2(coherence.eventRoster.eligibilitySnapshot);
      if (adopted.seasonId !== season.id || adopted.entryId !== coherence.entry.id || adopted.rosterRevisionId !== coherence.approvedRevision.id) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "已采用资格快照与当前赛事名单版本不一致。 ");
      }
      const current = rosterRows.filter((row) => row.eventRosterId === coherence.eventRoster.id);
      if (current.length !== adopted.members.length || current.some((member) => !adopted.members.some((frozen) =>
        frozen.eventRosterMemberId === member.eventRosterMemberId && frozen.userId === member.userId && frozen.participantId === member.participantId &&
        frozen.educationVerificationId === member.educationVerificationId && frozen.isPrimaryStarter === member.isPrimaryStarter &&
        frozen.source.rosterRevisionId === coherence.approvedRevision.id))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "已采用资格快照与冻结名单成员不一致。 ");
      }
      return adopted;
    })
    : undefined;
  // Legacy seasons retain their existing start-time fact load. V2 uses the
  // adopted eligibility snapshot and only reads current match sanctions.
  const needsQualificationLoad = definitionPolicy?.version !== 2 && (definitionPolicy !== undefined || competitiveProfile !== null || affiliationRules.length > 0) && frozenParticipantIds.length > 0;
  const qualificationFacts: ReadonlyMap<string, ParticipantQualificationFacts> = needsQualificationLoad
    ? await loadParticipantQualificationFacts(frozenParticipantIds, {
        executor: tx,
        platform: competitiveProfile
          ? competitiveProfile.platform
          : undefined,
        fallbackPlatform: competitiveProfile?.fallbackConversion?.sourcePlatform,
        includeCompetitiveFacts: competitiveProfile !== null,
      })
    : new Map<string, ParticipantQualificationFacts>();
  const membersByEventRoster = new Map<string, Array<{ userId: string; isPrimaryStarter: boolean }>>();
  for (const row of rosterRows) {
    const members = membersByEventRoster.get(row.eventRosterId) ?? [];
    members.push({ userId: row.userId, isPrimaryStarter: row.isPrimaryStarter });
    membersByEventRoster.set(row.eventRosterId, members);
  }
  const activeRestrictionOverrides = await loadActiveRestrictionOverridesInTx(tx, {
    competitionId: season.id,
    entryIds: entrantRows.map((entrant) => entrant.competitionEntryId),
    rosterRevisionIds: coherenceRows.map((row) => row.approvedRevision.id),
  });
  const overridesByEntryAndRevision = new Map<string, typeof activeRestrictionOverrides>();
  for (const override of activeRestrictionOverrides) {
    const key = `${override.entryId}:${override.rosterRevisionId}`;
    overridesByEntryAndRevision.set(key, [...(overridesByEntryAndRevision.get(key) ?? []), override]);
  }
  const qualificationBlockers: string[] = [];
  const participationBans = definitionPolicy?.version === 2
    ? await loadActiveSanctionsInTx(tx, { seasonId: season.id, effect: "match_participation_block", subjectUserIds: frozenParticipantIds })
    : new Map();
  for (const entrant of entrantRows) {
    const coherence = coherenceRows.find((row) => row.entry.id === entrant.competitionEntryId);
    if (definitionPolicy?.version === 2) {
      if (!coherence) throw new AppError(ErrorCode.VALIDATION_FAILED, "参赛条目缺少已冻结名单。");
      const adopted = frozenEligibilitySnapshots?.find((snapshot) => snapshot.entryId === entrant.competitionEntryId);
      const frozen = decodeFrozenLineupEligibility(adopted, { seasonId: season.id, entryId: entrant.competitionEntryId, rosterRevisionId: coherence.approvedRevision.id });
      const starters = rosterRows.filter((member) => member.eventRosterId === coherence.eventRoster.id && member.isPrimaryStarter);
      const result = evaluateLineup({ entryId: entrant.competitionEntryId, starterMemberIds: starters.map((member) => member.eventRosterMemberId), substituteMemberIds: [] }, frozen, new Set(participationBans.keys()));
      if (result.state === "blocked") qualificationBlockers.push(`参赛条目「${entryNameByEntryId.get(entrant.competitionEntryId) ?? entrant.competitionEntryId}」：${result.findings.map((finding) => finding.message).join(" ")}`);
      continue;
    }
    const rosterMembers = membersByEventRoster.get(coherenceRows.find((row) => row.entry.id === entrant.competitionEntryId)?.eventRoster.id ?? "") ?? [];
    if (rosterMembers.length === 0) continue; // readiness already blocks empty/absent frozen rosters.
    const qualification = await evaluateRosterQualificationFromFacts({
      members: rosterMembers.map((member) => {
        const fact = qualificationFacts.get(member.userId);
        return {
          userId: member.userId,
          label: fact ? getDisplayName(fact) : member.userId,
          emailVerifiedAt: fact?.emailVerifiedAt ?? null,
          educationHistory: fact?.educationHistory ?? [],
        };
      }),
      facts: qualificationFacts,
      affiliationRules,
      competitiveProfile,
      ...(definitionPolicy?.version === 1 ? { policy: { ...definitionPolicy, competitiveProfile } } : {}),
      primaryStarterUserIds: rosterMembers.filter((member) => member.isPrimaryStarter).map((member) => member.userId),
    });
    const overrides = coherence
      ? overridesByEntryAndRevision.get(`${entrant.competitionEntryId}:${coherence.approvedRevision.id}`) ?? []
      : [];
    const unresolved = unresolvedQualificationFindings(qualification.findings, overrides);
    if (unresolved.length > 0) {
      qualificationBlockers.push(`参赛条目「${entryNameByEntryId.get(entrant.competitionEntryId) ?? entrant.competitionEntryId}」：${unresolved.map((finding) => finding.message).join(" ")}`);
    }
  }
  if (qualificationBlockers.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, qualificationBlockers.join(" "));
  }
  const frozenCompetitiveFacts = (definitionPolicy?.version === 2 ? [] : frozenParticipantIds).map((userId) => {
    const fact = qualificationFacts.get(userId);
    const effective = competitiveProfile && fact ? toPlayerStrengthInput(fact, competitiveProfile) : null;
    const serialize = (peak: ReturnType<typeof toPlayerStrengthInput>["historicalPeak"] | null | undefined) => (
      peak?.rank && peak.rating !== null && peak.rating !== undefined
        ? {
            rank: peak.rank,
            rating: peak.rating,
            ratingComparable: peak.ratingComparable ?? true,
            stars: peak.stars ?? null,
            sourcePlatform: peak.sourcePlatform ?? competitiveProfile?.platform,
            sourceSeasonKey: peak.sourceSeasonKey ?? null,
            sourceRank: peak.sourceRank ?? peak.rank,
            sourceStars: peak.sourceStars ?? null,
            conversionVersion: peak.conversionVersion ?? null,
          }
        : null
    );
    return {
      userId,
      label: effective?.label ?? (fact ? getDisplayName(fact) : userId),
      historicalPeak: competitiveProfile ? serialize(effective?.historicalPeak) : null,
      previousSeasonPeak: competitiveProfile
        ? serialize(effective?.previousSeasonPeak)
        : null,
      currentSeasonPeak: competitiveProfile
        ? serialize(effective?.currentSeasonPeak)
        : null,
      recentSeasonPeaks: competitiveProfile?.evidencePolicy
        ? effective?.recentSeasonPeaks?.map(serialize) ?? []
        : undefined,
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
    affiliationRules: freezeAffiliationRules(affiliationRules),
    competitiveProfile,
    qualificationPolicy: capabilities.teamRegistrationConfig.qualificationPolicy
      ? { ...structuredClone(capabilities.teamRegistrationConfig.qualificationPolicy), competitiveProfile: competitiveProfile ?? capabilities.teamRegistrationConfig.qualificationPolicy.competitiveProfile }
      : {
          externalStrengthGap: {
            enabled: competitiveProfile !== null,
            maxGap: competitiveProfile?.externalStrengthMaxStarGap ?? 3,
          },
        },
    frozenRestrictionOverrides: activeRestrictionOverrides.map((override) => ({
      entryId: override.entryId,
      rosterRevisionId: override.rosterRevisionId,
      restrictionCode: override.restrictionCode,
      findingSnapshot: override.findingSnapshot,
      reason: override.reason,
      grantedBy: override.grantedBy,
      grantedAt: override.grantedAt.toISOString(),
    })),
    // Immutable participant-level historical / previous / current values.
    // Match lineup validation must never consult mutable rank facts again.
    frozenCompetitiveFacts,
    ...(frozenEligibilitySnapshots ? { frozenEligibilitySnapshots } : {}),
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
  await writeAuditInTx(tx, {
    seasonId: season.id,
    action: "major.start",
    actorId: input.actorId,
    targetId: stageRun.id,meta: {
      stageKey: stage.key,
      lockedEntrants: entrantCapacity,
      lockedRosters: entrantCapacity,
      lockedTournamentSeeds: entrantCapacity,
      stageEntrants: 16,
      managedMatches: createdMatches.length,
    },
  });
  await syncAutomaticPickEmInTx(tx, season.id);
  return { stageRunId: stageRun.id, created: true, matchCount: createdMatches.length };
}
