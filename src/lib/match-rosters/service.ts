import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  competitionEntries,
  educationVerifications,
  eventRosterMembers,
  eventRosters,
  institutions,
  majorStageRuns,
  matchCommentators,
  matchRosterPlayers,
  matchRosters,
  matches,
  seasons,
  type Match,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { frozenStageRunAffiliationRules } from "@/lib/major/frozen-affiliation-rules";
import { parseMajorRunSnapshot } from "@/lib/major/run-snapshot";
import { evaluateExternalStrengthRule, getPlayerStrengthBreakdown, type PlayerStrengthInput } from "@/lib/major/player-strength";
import { unresolvedQualificationFindings } from "@/lib/competition-entries/restriction-overrides";
import type { FrozenRestrictionOverrideSnapshot } from "@/lib/major/run-snapshot";
import { assertMatchTransition } from "@/lib/match-transitions";
import { loadActiveSanctionsInTx } from "@/lib/discipline/service";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import type { CompetitiveProfileConfig, InstitutionAffiliationRule } from "@/types/season";
import { evaluateStartingLineup, type LineupMemberFact } from "./lineup";
import { resolveMatchLineupPolicy, type MatchLineupPolicy } from "./policy";

/**
 * G1 transactional services behind every explicit lineup action:
 * participant submit, admin select, confirm, and the start gate.
 * Server Actions stay thin wrappers (session + revalidate) around these so the
 * local PostgreSQL integration suite can drive the exact production logic.
 */

export interface TeamLineupContext {
  /** Affiliation rules frozen in the StageRun snapshot; empty outside Major. */
  rules: readonly InstitutionAffiliationRule[];
  frozenRosterUserIds: ReadonlySet<string> | null;
  memberFacts: Map<string, LineupMemberFact>;
  competitiveProfile: CompetitiveProfileConfig | null;
  frozenCompetitiveFacts: Map<string, PlayerStrengthInput> | null;
  /** Source revision of the frozen event roster, used to bind snapshot overrides. */
  frozenRosterRevisionId: string | null;
  /** Explicitly absent on legacy StageRuns, which must not gain new rules. */
  externalStrengthGapEnabled: boolean;
  frozenRestrictionOverrides: readonly FrozenRestrictionOverrideSnapshot[];
  policy: MatchLineupPolicy;
}

function frozenCompetitiveProfile(ruleSnapshot: unknown): CompetitiveProfileConfig | null {
  if (!ruleSnapshot || typeof ruleSnapshot !== "object") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少冻结规则。");
  const candidate = (ruleSnapshot as { competitiveProfile?: unknown }).competitiveProfile;
  if (candidate === null) return null;
  if (!candidate || typeof candidate !== "object") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少冻结的竞技档案规则。");
  const profile = candidate as Partial<CompetitiveProfileConfig>;
  if (typeof profile.platform !== "string" || typeof profile.currentSeasonKey !== "string" || typeof profile.previousSeasonKey !== "string" || !Array.isArray(profile.rankOrder)) throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的竞技档案规则不可用。");
  const policy = profile.evidencePolicy;
  if (policy && (policy.historicalWeight !== 50 || policy.referenceSeasonWeight !== 20 || policy.recentSeasonWeight !== 30 || typeof policy.referenceSeasonKey !== "string" || !Array.isArray(policy.recentSeasonKeys) || !policy.recentSeasonKeys.every((key) => typeof key === "string"))) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的竞技参考策略不可用。");
  }
  if (profile.externalStrengthMaxStarGap !== undefined && (!Number.isSafeInteger(profile.externalStrengthMaxStarGap) || profile.externalStrengthMaxStarGap < 0)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的外校星差阈值不可用。 ");
  }
  const fallback = profile.fallbackConversion;
  if (fallback && (fallback.sourcePlatform !== "fivee" || typeof fallback.version !== "string" || !fallback.seasonKeyMap || typeof fallback.seasonKeyMap !== "object" || !fallback.mapping || typeof fallback.mapping !== "object")) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的 5E fallback 映射不可用。");
  }
  return {
    platform: profile.platform,
    currentSeasonKey: profile.currentSeasonKey,
    previousSeasonKey: profile.previousSeasonKey,
    rankOrder: profile.rankOrder.filter((rank): rank is string => typeof rank === "string"),
    evidencePolicy: policy ? { historicalWeight: 50, referenceSeasonKey: policy.referenceSeasonKey, referenceSeasonWeight: 20, recentSeasonKeys: [...policy.recentSeasonKeys], recentSeasonWeight: 30 } : undefined,
    fallbackConversion: fallback ? { sourcePlatform: "fivee", version: fallback.version, seasonKeyMap: { ...fallback.seasonKeyMap }, mapping: fallback.mapping } : undefined,
    externalStrengthMaxStarGap: typeof profile.externalStrengthMaxStarGap === "number" ? profile.externalStrengthMaxStarGap : undefined,
  };
}

function frozenCompetitiveFacts(ruleSnapshot: unknown): Map<string, PlayerStrengthInput> {
  if (!ruleSnapshot || typeof ruleSnapshot !== "object") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少冻结竞技事实。");
  const rows = (ruleSnapshot as { frozenCompetitiveFacts?: unknown }).frozenCompetitiveFacts;
  if (!Array.isArray(rows)) throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少冻结竞技事实。");
  const result = new Map<string, PlayerStrengthInput>();
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
    const value = row as { userId?: unknown; label?: unknown; historicalPeak?: unknown; previousSeasonPeak?: unknown; currentSeasonPeak?: unknown; recentSeasonPeaks?: unknown };
    if (typeof value.userId !== "string" || !value.userId) throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
    if (value.label !== undefined && (typeof value.label !== "string" || !value.label)) throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
    const rank = (fact: unknown) => {
      if (fact === null) return null;
      if (!fact || typeof fact !== "object") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
      const candidate = fact as { rank?: unknown; rating?: unknown; ratingComparable?: unknown; stars?: unknown; sourcePlatform?: unknown; sourceSeasonKey?: unknown; sourceRank?: unknown; conversionVersion?: unknown };
      if (typeof candidate.rank !== "string" || typeof candidate.rating !== "number") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
      if (candidate.ratingComparable !== undefined && typeof candidate.ratingComparable !== "boolean") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
      if (candidate.stars !== undefined && candidate.stars !== null && typeof candidate.stars !== "number") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
      if (candidate.sourcePlatform !== undefined && typeof candidate.sourcePlatform !== "string") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
      if (candidate.sourceSeasonKey !== undefined && candidate.sourceSeasonKey !== null && typeof candidate.sourceSeasonKey !== "string") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
      if (candidate.sourceRank !== undefined && typeof candidate.sourceRank !== "string") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
      if (candidate.conversionVersion !== undefined && candidate.conversionVersion !== null && typeof candidate.conversionVersion !== "string") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
      return {
        rank: candidate.rank,
        rating: candidate.rating,
        ratingComparable: candidate.ratingComparable,
        stars: candidate.stars as number | null | undefined,
        sourcePlatform: candidate.sourcePlatform,
        sourceSeasonKey: candidate.sourceSeasonKey as string | null | undefined,
        sourceRank: candidate.sourceRank,
        conversionVersion: candidate.conversionVersion as string | undefined,
      };
    };
    if (value.recentSeasonPeaks !== undefined && !Array.isArray(value.recentSeasonPeaks)) throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结竞技事实不可用。");
    result.set(value.userId, {
      userId: value.userId,
      label: typeof value.label === "string" ? value.label : value.userId,
      historicalPeak: rank(value.historicalPeak),
      previousSeasonPeak: rank(value.previousSeasonPeak),
      currentSeasonPeak: rank(value.currentSeasonPeak),
      recentSeasonPeaks: Array.isArray(value.recentSeasonPeaks) ? value.recentSeasonPeaks.map(rank) : undefined,
    });
  }
  return result;
}

/** Row-lock the match so status transitions and roster mutations serialize. */
export async function lockMatchInTx(tx: TxDb, matchId: string): Promise<Match> {
  const [locked] = await tx
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .for("update");
  if (!locked) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
  await assertSeasonAllowsTournamentMutationInTx(tx, locked.seasonId);
  return locked;
}

function assertScheduledOrThrow(match: Pick<Match, "status">): void {
  if (match.status !== "scheduled") {
    throw new AppError(
      ErrorCode.MATCH_INVALID_TRANSITION,
      `比赛当前状态为 ${match.status}，阵容只能在开赛前调整。`,
    );
  }
}

/** Entrant membership resolves the frozen tournament roster per canonical team. */
async function loadFrozenRosterUserIdsInTx(
  tx: TxDb,
  seasonId: string,
  entryId: string,
): Promise<{ ids: ReadonlySet<string>; verificationsByUser: Map<string, LineupMemberFact["verification"]>; rosterRevisionId: string | null }> {
  const [roster] = await tx
    .select({ id: eventRosters.id, status: eventRosters.status, sourceRosterRevisionId: eventRosters.sourceRosterRevisionId })
    .from(eventRosters)
    .innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
    .where(and(eq(competitionEntries.competitionId, seasonId), eq(eventRosters.entryId, entryId)));
  if (!roster || roster.status !== "frozen") {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "CompetitionEntry 缺少 frozen event roster，无法校验本场名单。",
    );
  }

  const rows = await tx
    .select({
      id: eventRosterMembers.id,
      userId: eventRosterMembers.userId,
      status: educationVerifications.status,
      institutionCode: institutions.moeInstitutionCode,
      academicStatus: educationVerifications.academicStatus,
    })
    .from(eventRosterMembers)
    // The authoritative verification adopted by the frozen tournament roster.
    .innerJoin(
      educationVerifications,
      eq(educationVerifications.id, eventRosterMembers.educationVerificationId),
    )
    .innerJoin(institutions, eq(institutions.id, educationVerifications.institutionId))
    .where(eq(eventRosterMembers.eventRosterId, roster.id));

  const ids = new Set<string>();
  const verificationsByUser = new Map<string, LineupMemberFact["verification"]>();
  for (const row of rows) {
    ids.add(row.userId);
    if (!verificationsByUser.has(row.userId)) {
      verificationsByUser.set(row.userId, {
        institutionCode: row.institutionCode ?? null,
        academicStatus: row.academicStatus,
        status: row.status,
      });
    }
  }
  return { ids, verificationsByUser, rosterRevisionId: roster.sourceRosterRevisionId };
}

async function loadTeamLineupContextInTx(
  tx: TxDb,
  match: Match,
  entryId: string,
): Promise<TeamLineupContext> {
  const canonicalEntry = await tx
    .select({ id: competitionEntries.id })
    .from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, match.seasonId), eq(competitionEntries.id, entryId)));
  if (canonicalEntry.length === 0 || (match.entryAId !== entryId && match.entryBId !== entryId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "参赛队伍不属于本场比赛的赛季。");
  }

  let rules: readonly InstitutionAffiliationRule[] = [];
  let frozenRosterUserIds: ReadonlySet<string> | null = null;
  let verificationsByUser: Map<string, LineupMemberFact["verification"]> | null = null;
  let competitiveProfile: CompetitiveProfileConfig | null = null;
  let frozenCompetitiveFactsByUser: Map<string, PlayerStrengthInput> | null = null;
  let frozenRosterRevisionId: string | null = null;
  let externalStrengthGapEnabled = false;
  let frozenRestrictionOverrides: readonly FrozenRestrictionOverrideSnapshot[] = [];
  const [season] = await tx
    .select({ starterCount: seasons.starterCount })
    .from(seasons)
    .where(eq(seasons.id, match.seasonId));
  if (!season) throw new AppError(ErrorCode.INTERNAL_ERROR, "比赛所属赛季不存在。");
  let policy: MatchLineupPolicy;
  if (match.ownership !== "major_stage") {
    policy = resolveMatchLineupPolicy({ ownership: match.ownership, seasonStarterCount: season.starterCount });
  } else {
    // Assigned below after the canonical StageRun snapshot has been loaded.
    policy = { starterCount: 0, maxSubstitutes: 0 };
  }

  if (match.ownership === "major_stage") {
    if (!match.majorStageRunId) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "托管比赛缺少对应的 StageRun。");
    }
    const [stageRun] = await tx
      .select({ ruleSnapshot: majorStageRuns.ruleSnapshot, stageKey: majorStageRuns.stageKey })
      .from(majorStageRuns)
      .where(eq(majorStageRuns.id, match.majorStageRunId));
    if (!stageRun) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "托管比赛缺少对应的 StageRun。");
    }
    // Parse once before every frozen consumer; never use mutable season rules.
    const frozenSnapshot = parseMajorRunSnapshot(stageRun.ruleSnapshot, stageRun.stageKey);
    externalStrengthGapEnabled = frozenSnapshot.qualificationPolicy?.externalStrengthGap?.enabled === true;
    frozenRestrictionOverrides = frozenSnapshot.frozenRestrictionOverrides ?? [];
    policy = resolveMatchLineupPolicy({
      ownership: match.ownership,
      seasonStarterCount: season.starterCount,
      majorStageRun: stageRun,
    });
    // Frozen at StageRun creation; never read from mutable season configuration.
    rules = frozenStageRunAffiliationRules(stageRun.ruleSnapshot);
    const configuredCompetitiveProfile = frozenCompetitiveProfile(stageRun.ruleSnapshot);
    // The StageRun policy is the runtime authority.  Keep the profile's
    // platform/rank facts, but consume the threshold that was frozen with
    // this run instead of a mutable or merely duplicated profile value.
    competitiveProfile = configuredCompetitiveProfile && frozenSnapshot.qualificationPolicy?.externalStrengthGap
      ? {
          ...configuredCompetitiveProfile,
          externalStrengthMaxStarGap: frozenSnapshot.qualificationPolicy.externalStrengthGap.maxGap,
        }
      : configuredCompetitiveProfile;
    frozenCompetitiveFactsByUser = competitiveProfile ? frozenCompetitiveFacts(stageRun.ruleSnapshot) : null;
    const frozen = await loadFrozenRosterUserIdsInTx(tx, match.seasonId, entryId);
    frozenRosterUserIds = frozen.ids;
    verificationsByUser = frozen.verificationsByUser;
    frozenRosterRevisionId = frozen.rosterRevisionId;
    if (externalStrengthGapEnabled && !competitiveProfile) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 启用了外校星差规则但缺少冻结竞技档案。 ");
    }
  }

  const memberRows = await tx
    .select({ id: eventRosterMembers.id, userId: eventRosterMembers.userId })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .where(and(eq(eventRosters.entryId, entryId), eq(eventRosters.status, "frozen")));

  // H1: active match-participation sanctions apply to every ownership mode.
  const participationBans = await loadActiveSanctionsInTx(tx, {
    seasonId: match.seasonId,
    effect: "match_participation_block",
    subjectUserIds: memberRows.map((row) => row.userId),
  });

  const memberFacts = new Map<string, LineupMemberFact>();
  for (const row of memberRows) {
    memberFacts.set(row.id, {
      eventRosterMemberId: row.id,
      userId: row.userId,
      verification:
        (rules.length > 0 ? verificationsByUser?.get(row.userId) : null) ?? null,
      participationBlocked: participationBans.has(row.userId),
    });
  }

  return { rules, frozenRosterUserIds, memberFacts, competitiveProfile, frozenCompetitiveFacts: frozenCompetitiveFactsByUser, frozenRosterRevisionId, externalStrengthGapEnabled, frozenRestrictionOverrides, policy };
}

export async function assertStartingLineupAllowedInTx(
  tx: TxDb,
  args: {
    match: Match;
    entryId: string;
    starterIds: readonly string[];
    substituteIds?: readonly string[];
  },
): Promise<{ affiliatedStarterCounts: Map<string, number> }> {
  const preflight = await getStartingLineupPreflightInTx(tx, args);
  if (!preflight.valid) throw new AppError(ErrorCode.VALIDATION_FAILED, preflight.blockers.join("；"));
  return { affiliatedStarterCounts: preflight.affiliatedStarterCounts };
}

/** Read-only counterpart of the start gate. It deliberately shares every eligibility branch with start. */
export async function getStartingLineupPreflightInTx(
  tx: TxDb,
  args: { match: Match; entryId: string; starterIds: readonly string[]; substituteIds?: readonly string[] },
): Promise<{ valid: boolean; blockers: string[]; affiliatedStarterCounts: Map<string, number> }> {
  const context = await loadTeamLineupContextInTx(tx, args.match, args.entryId);
  const result = evaluateStartingLineup({
    starterIds: args.starterIds,
    substituteIds: args.substituteIds,
    policy: context.policy,
    memberFacts: context.memberFacts,
    frozenRosterUserIds: context.frozenRosterUserIds ?? undefined,
    affiliationRules: context.rules.length > 0 ? context.rules : undefined,
  });
  const blockers = [...result.blockers];
  if (context.competitiveProfile) {
    const starterFacts = args.starterIds.map((id) => context.memberFacts.get(id)).filter((item): item is LineupMemberFact => Boolean(item));
    const players = starterFacts.map((member) => {
      const strength = context.frozenCompetitiveFacts?.get(member.userId);
      if (!strength) {
        blockers.push(`首发 ${member.userId} 缺少本届冻结的竞技档案。`);
        return { userId: member.userId, label: member.userId, historicalPeak: null, previousSeasonPeak: null, currentSeasonPeak: null, isHome: false };
      }
      const required = getPlayerStrengthBreakdown(strength, context.competitiveProfile!);
      if (!required.available) blockers.push(`首发 ${member.userId} 的竞技档案不可确认：${required.blockers.join(" ")}`);
      const verification = member.verification;
      const isHome = Boolean(verification && context.rules.some((rule) => rule.institutionCode === verification.institutionCode && rule.eligibleAcademicStatuses.includes(verification.academicStatus)));
      return { ...strength, isHome };
    });
    // The new external-strength policy is opt-in in the frozen snapshot. A
    // legacy StageRun without this capability keeps its historical
    // completeness/affiliation semantics and is never reinterpreted by the
    // current three-star rule.
    if (context.externalStrengthGapEnabled) {
      const externalRule = evaluateExternalStrengthRule({ players, config: context.competitiveProfile });
      const overrides = context.frozenRestrictionOverrides.filter((override) =>
        override.entryId === args.entryId && override.rosterRevisionId === context.frozenRosterRevisionId,
      );
      const unresolved = unresolvedQualificationFindings(externalRule.findings, overrides);
      blockers.push(...unresolved.map((finding) => finding.message));
    }
  }
  return { valid: blockers.length === 0, blockers: [...new Set(blockers)], affiliatedStarterCounts: result.affiliatedStarterCounts };
}

function loadPersistedPlayers(
  players: readonly { eventRosterMemberId: string; isStarter: boolean }[],
): { starterIds: string[]; substituteIds: string[] } {
  return {
    starterIds: players.filter((row) => row.isStarter).map((row) => row.eventRosterMemberId),
    substituteIds: players.filter((row) => !row.isStarter).map((row) => row.eventRosterMemberId),
  };
}

export interface PersistedRosterSummary {
  rosterId: string;
  matchId: string;
  entryId: string;
  starterIds: string[];
  substituteIds: string[];
}

/**
 * Upsert the explicit lineup for (match, team). Callers must have validated the
 * lineup first; this only records the fact.
 */
export async function persistMatchRosterInTx(
  tx: TxDb,
  args: {
    match: Match;
    entryId: string;
    submittedBy: string | null;
    source: "participant" | "admin_select";
    starterIds: readonly string[];
    substituteIds?: readonly string[];
  },
): Promise<PersistedRosterSummary> {
  const substituteIds = args.substituteIds ?? [];
  const now = new Date();
  const [existing] = await tx
    .select({ id: matchRosters.id })
    .from(matchRosters)
    .where(and(eq(matchRosters.matchId, args.match.id), eq(matchRosters.entryId, args.entryId)));

  let rosterId: string;
  if (existing) {
    rosterId = existing.id;
    await tx
      .update(matchRosters)
      .set({
        status: "submitted",
        submittedBy: args.submittedBy,
        source: args.source,
        lockedAt: now,
        confirmedAt: null,
        confirmedBy: null,
        updatedAt: now,
      })
      .where(eq(matchRosters.id, existing.id));
    await tx.delete(matchRosterPlayers).where(eq(matchRosterPlayers.rosterId, existing.id));
  } else {
    const inserted = await tx
      .insert(matchRosters)
      .values({
        matchId: args.match.id,
        entryId: args.entryId,
        submittedBy: args.submittedBy,
        source: args.source,
        status: "submitted",
        lockedAt: now,
      })
      .returning({ id: matchRosters.id });
    if (!inserted[0]) throw new AppError(ErrorCode.INTERNAL_ERROR, "写入比赛名单失败。");
    rosterId = inserted[0].id;
  }

  await tx.insert(matchRosterPlayers).values([
    ...args.starterIds.map((id) => ({ rosterId, eventRosterMemberId: id, isStarter: true })),
    ...substituteIds.map((id) => ({ rosterId, eventRosterMemberId: id, isStarter: false })),
  ]);

  return {
    rosterId,
    matchId: args.match.id,
    entryId: args.entryId,
    starterIds: [...args.starterIds],
    substituteIds: [...substituteIds],
  };
}

export interface ConfirmRosterOutcome {
  rosterId: string;
  matchId: string;
  entryId: string;
  starterIds: string[];
  alreadyConfirmed: boolean;
}

export async function confirmMatchRosterInTx(
  tx: TxDb,
  args: { rosterId: string; actorId: string },
): Promise<ConfirmRosterOutcome> {
  const [roster] = await tx
    .select()
    .from(matchRosters)
    .where(eq(matchRosters.id, args.rosterId))
    .for("update");
  if (!roster) throw new AppError(ErrorCode.NOT_FOUND, "名单不存在。");

  const match = await lockMatchInTx(tx, roster.matchId);
  assertScheduledOrThrow(match);

  const players = await tx
    .select({ eventRosterMemberId: matchRosterPlayers.eventRosterMemberId, isStarter: matchRosterPlayers.isStarter })
    .from(matchRosterPlayers)
    .where(eq(matchRosterPlayers.rosterId, roster.id));
  if (players.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "名单没有任何队员，无法确认。");
  }
  const { starterIds, substituteIds } = loadPersistedPlayers(players);

  if (roster.status === "confirmed") {
    // Idempotent re-confirm: state unchanged, no duplicate audit event.
    return { rosterId: roster.id, matchId: match.id, entryId: roster.entryId, starterIds, alreadyConfirmed: true };
  }

  // Re-validate against fresh facts; confirmation is an eligibility decision.
  await assertStartingLineupAllowedInTx(tx, {
    match,
    entryId: roster.entryId,
    starterIds,
    substituteIds,
  });

  const now = new Date();
  await tx
    .update(matchRosters)
    .set({ status: "confirmed", confirmedAt: now, confirmedBy: args.actorId, updatedAt: now })
    .where(eq(matchRosters.id, roster.id));

  await tx.insert(auditLogs).values({
    seasonId: match.seasonId,
    action: "match.roster.confirm",
    actorId: args.actorId,
    targetId: roster.id,
    targetType: "match_roster",
    meta: { matchId: match.id, entryId: roster.entryId, starterIds, substituteIds },
  });

  return { rosterId: roster.id, matchId: match.id, entryId: roster.entryId, starterIds, alreadyConfirmed: false };
}

export interface StartLineupSummary extends PersistedRosterSummary {
  status: "confirmed";
}

export interface MatchTransitionOutcome {
  from: Match["status"];
  to: "in_progress" | "cancelled";
  lineups: StartLineupSummary[] | null;
}

/**
 * The complete production body of a match status transition, shared by the
 * Server Action wrapper and the local integration suite:
 * row-lock → re-checked state machine gate → (start) both-teams-confirmed
 * lineup gate → status write → audit (match.start / match.status_update).
 */
export async function applyMatchStatusTransitionInTx(
  tx: TxDb,
  args: { matchId: string; nextStatus: "in_progress" | "cancelled"; actorId: string },
): Promise<MatchTransitionOutcome> {
  const locked = await lockMatchInTx(tx, args.matchId);
  assertMatchTransition(locked.status, args.nextStatus);
  const lineups =
    args.nextStatus === "in_progress"
      ? await assertConfirmedLineupsForStartInTx(tx, locked)
      : null;
  const clearedCommentators =
    args.nextStatus === "cancelled"
      ? await tx.delete(matchCommentators).where(eq(matchCommentators.matchId, locked.id)).returning({ userId: matchCommentators.userId })
      : [];

  await tx
    .update(matches)
    .set({ status: args.nextStatus, updatedAt: new Date() })
    .where(eq(matches.id, args.matchId));

  await tx.insert(auditLogs).values({
    seasonId: locked.seasonId,
    action: args.nextStatus === "in_progress" ? "match.start" : "match.status_update",
    actorId: args.actorId,
    targetId: args.matchId,
    targetType: "match",
    meta: {
      from: locked.status,
      to: args.nextStatus,
      ...(lineups
        ? {
            lineups: lineups.map((summary) => ({
              entryId: summary.entryId,
              rosterId: summary.rosterId,
              starterIds: summary.starterIds,
              substituteIds: summary.substituteIds,
            })),
          }
        : {}),
      ...(clearedCommentators.length > 0
        ? { clearedCommentatorUserIds: clearedCommentators.map((commentator) => commentator.userId) }
        : {}),
    },
  });

  return { from: locked.status, to: args.nextStatus, lineups };
}

/**
 * Start gate: both canonical teams must hold an already-confirmed lineup that
 * still validates against freshly loaded facts. There is no fallback path here
 * by design — nothing infers starters from membership ordering.
 */
async function assertConfirmedLineupsForStartInTx(
  tx: TxDb,
  match: Match,
): Promise<StartLineupSummary[]> {
  const rosters = await tx
    .select()
    .from(matchRosters)
    .where(eq(matchRosters.matchId, match.id));
  const rosterByEntry = new Map(rosters.map((row) => [row.entryId, row]));

  const summaries: StartLineupSummary[] = [];
  for (const entryId of [match.entryAId, match.entryBId]) {
    const roster = rosterByEntry.get(entryId);
    if (!roster) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        "该场比赛还有队伍未提交并确认首发阵容，不能开始比赛。",
      );
    }
    if (roster.status !== "confirmed") {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        "存在尚未确认的首发阵容，必须先执行名单确认才能开始比赛。",
      );
    }

    const players = await tx
      .select({ eventRosterMemberId: matchRosterPlayers.eventRosterMemberId, isStarter: matchRosterPlayers.isStarter })
      .from(matchRosterPlayers)
      .where(eq(matchRosterPlayers.rosterId, roster.id));
    const { starterIds, substituteIds } = loadPersistedPlayers(players);

    await assertStartingLineupAllowedInTx(tx, { match, entryId, starterIds, substituteIds });
    summaries.push({ rosterId: roster.id, matchId: match.id, entryId, starterIds, substituteIds, status: "confirmed" });
  }
  return summaries;
}
