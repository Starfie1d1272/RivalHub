import { and, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  competitiveRankFacts,
  educationVerifications,
  institutions,
  majorPrestartEntrants,
  majorPrestartRosterMembers,
  majorStageRuns,
  matchRosterPlayers,
  matchRosters,
  matches,
  teamMembers,
  teams,
  type Match,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { frozenStageRunAffiliationRules } from "@/lib/major/frozen-affiliation-rules";
import { evaluateExternalStrengthRule, getPlayerStrengthBreakdown, type PlayerStrengthInput } from "@/lib/major/player-strength";
import { assertMatchTransition } from "@/lib/match-transitions";
import { loadActiveSanctionsInTx } from "@/lib/discipline/service";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import type { CompetitiveProfileConfig, InstitutionAffiliationRule } from "@/types/season";
import { evaluateStartingLineup, type LineupMemberFact } from "./lineup";

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
}

function frozenCompetitiveProfile(ruleSnapshot: unknown): CompetitiveProfileConfig | null {
  if (!ruleSnapshot || typeof ruleSnapshot !== "object") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少冻结规则。");
  const candidate = (ruleSnapshot as { competitiveProfile?: unknown }).competitiveProfile;
  if (candidate === null) return null;
  if (!candidate || typeof candidate !== "object") throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少冻结的竞技档案规则。");
  const profile = candidate as Partial<CompetitiveProfileConfig>;
  if (typeof profile.platform !== "string" || typeof profile.currentSeasonKey !== "string" || typeof profile.previousSeasonKey !== "string" || !Array.isArray(profile.rankOrder)) throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的竞技档案规则不可用。");
  return { platform: profile.platform, currentSeasonKey: profile.currentSeasonKey, previousSeasonKey: profile.previousSeasonKey, rankOrder: profile.rankOrder.filter((rank): rank is string => typeof rank === "string") };
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
  teamId: string,
): Promise<{ ids: ReadonlySet<string>; verificationsByUser: Map<string, LineupMemberFact["verification"]> }> {
  const [entrant] = await tx
    .select({ id: majorPrestartEntrants.id })
    .from(majorPrestartEntrants)
    .where(
      and(eq(majorPrestartEntrants.seasonId, seasonId), eq(majorPrestartEntrants.teamId, teamId)),
    );
  if (!entrant) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "参赛队缺少官方 entrant 记录，无法校验本届冻结名单。",
    );
  }

  const rows = await tx
    .select({
      userId: majorPrestartRosterMembers.userId,
      status: educationVerifications.status,
      institutionCode: institutions.moeInstitutionCode,
      academicStatus: educationVerifications.academicStatus,
    })
    .from(majorPrestartRosterMembers)
    // The authoritative verification adopted by the frozen tournament roster.
    .innerJoin(
      educationVerifications,
      eq(educationVerifications.id, majorPrestartRosterMembers.educationVerificationId),
    )
    .innerJoin(institutions, eq(institutions.id, educationVerifications.institutionId))
    .where(eq(majorPrestartRosterMembers.entrantId, entrant.id));

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
  return { ids, verificationsByUser };
}

export async function loadTeamLineupContextInTx(
  tx: TxDb,
  match: Match,
  teamId: string,
): Promise<TeamLineupContext> {
  const canonicalTeam = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.seasonId, match.seasonId), eq(teams.id, teamId)));
  if (canonicalTeam.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "参赛队伍不属于本场比赛的赛季。");
  }

  let rules: readonly InstitutionAffiliationRule[] = [];
  let frozenRosterUserIds: ReadonlySet<string> | null = null;
  let verificationsByUser: Map<string, LineupMemberFact["verification"]> | null = null;
  let competitiveProfile: CompetitiveProfileConfig | null = null;

  if (match.ownership === "major_stage") {
    if (!match.majorStageRunId) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "托管比赛缺少对应的 StageRun。");
    }
    const [stageRun] = await tx
      .select({ ruleSnapshot: majorStageRuns.ruleSnapshot })
      .from(majorStageRuns)
      .where(eq(majorStageRuns.id, match.majorStageRunId));
    if (!stageRun) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "托管比赛缺少对应的 StageRun。");
    }
    // Frozen at StageRun creation; never read from mutable season configuration.
    rules = frozenStageRunAffiliationRules(stageRun.ruleSnapshot);
    competitiveProfile = frozenCompetitiveProfile(stageRun.ruleSnapshot);
    const frozen = await loadFrozenRosterUserIdsInTx(tx, match.seasonId, teamId);
    frozenRosterUserIds = frozen.ids;
    verificationsByUser = frozen.verificationsByUser;
  }

  const memberRows = await tx
    .select({ id: teamMembers.id, userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));

  // H1: active match-participation sanctions apply to every ownership mode.
  const participationBans = await loadActiveSanctionsInTx(tx, {
    seasonId: match.seasonId,
    effect: "match_participation_block",
    subjectUserIds: memberRows.map((row) => row.userId),
  });

  const memberFacts = new Map<string, LineupMemberFact>();
  for (const row of memberRows) {
    memberFacts.set(row.id, {
      teamMemberId: row.id,
      userId: row.userId,
      verification:
        (rules.length > 0 ? verificationsByUser?.get(row.userId) : null) ?? null,
      participationBlocked: participationBans.has(row.userId),
    });
  }

  return { rules, frozenRosterUserIds, memberFacts, competitiveProfile };
}

export async function assertStartingLineupAllowedInTx(
  tx: TxDb,
  args: {
    match: Match;
    teamId: string;
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
  args: { match: Match; teamId: string; starterIds: readonly string[]; substituteIds?: readonly string[] },
): Promise<{ valid: boolean; blockers: string[]; affiliatedStarterCounts: Map<string, number> }> {
  const context = await loadTeamLineupContextInTx(tx, args.match, args.teamId);
  const result = evaluateStartingLineup({
    starterIds: args.starterIds,
    substituteIds: args.substituteIds,
    allowSubstitutes: args.match.ownership !== "major_stage",
    memberFacts: context.memberFacts,
    frozenRosterUserIds: context.frozenRosterUserIds ?? undefined,
    affiliationRules: context.rules.length > 0 ? context.rules : undefined,
  });
  const blockers = [...result.blockers];
  if (context.competitiveProfile) {
    const starterFacts = args.starterIds.map((id) => context.memberFacts.get(id)).filter((item): item is LineupMemberFact => Boolean(item));
    const userIds = starterFacts.map((item) => item.userId);
    const facts = userIds.length === 0 ? [] : await tx.select().from(competitiveRankFacts).where(and(eq(competitiveRankFacts.platform, context.competitiveProfile.platform), inArray(competitiveRankFacts.userId, userIds)));
    const players = starterFacts.map((member) => {
      const forUser = facts.filter((fact) => fact.userId === member.userId);
      const strength: PlayerStrengthInput = {
        userId: member.userId,
        label: member.userId,
        historicalPeak: (() => { const fact = forUser.find((item) => item.kind === "historical_peak" && item.platformSeasonKey === null); return fact ? { rank: fact.rank, rating: Number(fact.rating) } : null; })(),
        previousSeasonPeak: (() => { const fact = forUser.find((item) => item.kind === "season_peak" && item.platformSeasonKey === context.competitiveProfile!.previousSeasonKey); return fact ? { rank: fact.rank, rating: Number(fact.rating) } : null; })(),
        currentSeasonPeak: (() => { const fact = forUser.find((item) => item.kind === "season_peak" && item.platformSeasonKey === context.competitiveProfile!.currentSeasonKey); return fact ? { rank: fact.rank, rating: Number(fact.rating) } : null; })(),
      };
      const required = getPlayerStrengthBreakdown(strength, context.competitiveProfile!);
      if (!required.available) blockers.push(`首发 ${member.userId} 的竞技档案不可确认：${required.blockers.join(" ")}`);
      const verification = member.verification;
      const isHome = Boolean(verification && context.rules.some((rule) => rule.institutionCode === verification.institutionCode && rule.eligibleAcademicStatuses.includes(verification.academicStatus)));
      return { ...strength, isHome };
    });
    const externalRule = evaluateExternalStrengthRule({ players, config: context.competitiveProfile });
    blockers.push(...externalRule.blockers);
  }
  return { valid: blockers.length === 0, blockers: [...new Set(blockers)], affiliatedStarterCounts: result.affiliatedStarterCounts };
}

function loadPersistedPlayers(
  players: readonly { teamMemberId: string; isStarter: boolean }[],
): { starterIds: string[]; substituteIds: string[] } {
  return {
    starterIds: players.filter((row) => row.isStarter).map((row) => row.teamMemberId),
    substituteIds: players.filter((row) => !row.isStarter).map((row) => row.teamMemberId),
  };
}

export interface PersistedRosterSummary {
  rosterId: string;
  matchId: string;
  teamId: string;
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
    teamId: string;
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
    .where(and(eq(matchRosters.matchId, args.match.id), eq(matchRosters.teamId, args.teamId)));

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
        updatedAt: now,
      })
      .where(eq(matchRosters.id, existing.id));
    await tx.delete(matchRosterPlayers).where(eq(matchRosterPlayers.rosterId, existing.id));
  } else {
    const inserted = await tx
      .insert(matchRosters)
      .values({
        matchId: args.match.id,
        teamId: args.teamId,
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
    ...args.starterIds.map((id) => ({ rosterId, teamMemberId: id, isStarter: true })),
    ...substituteIds.map((id) => ({ rosterId, teamMemberId: id, isStarter: false })),
  ]);

  return {
    rosterId,
    matchId: args.match.id,
    teamId: args.teamId,
    starterIds: [...args.starterIds],
    substituteIds: [...substituteIds],
  };
}

export interface ConfirmRosterOutcome {
  rosterId: string;
  matchId: string;
  teamId: string;
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
    .select({ teamMemberId: matchRosterPlayers.teamMemberId, isStarter: matchRosterPlayers.isStarter })
    .from(matchRosterPlayers)
    .where(eq(matchRosterPlayers.rosterId, roster.id));
  if (players.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "名单没有任何队员，无法确认。");
  }
  const { starterIds, substituteIds } = loadPersistedPlayers(players);

  if (roster.status === "confirmed") {
    // Idempotent re-confirm: state unchanged, no duplicate audit event.
    return { rosterId: roster.id, matchId: match.id, teamId: roster.teamId, starterIds, alreadyConfirmed: true };
  }

  // Re-validate against fresh facts; confirmation is an eligibility decision.
  await assertStartingLineupAllowedInTx(tx, {
    match,
    teamId: roster.teamId,
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
    meta: { matchId: match.id, teamId: roster.teamId, starterIds, substituteIds },
  });

  return { rosterId: roster.id, matchId: match.id, teamId: roster.teamId, starterIds, alreadyConfirmed: false };
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
              teamId: summary.teamId,
              rosterId: summary.rosterId,
              starterIds: summary.starterIds,
              substituteIds: summary.substituteIds,
            })),
          }
        : {}),
    },
  });

  return { from: locked.status, to: args.nextStatus, lineups };
}

/**
 * Start gate: both canonical teams must hold an already-confirmed lineup that
 * still validates against freshly loaded facts. There is no fallback path here
 * by design — nothing infers starters from team_members ordering.
 */
export async function assertConfirmedLineupsForStartInTx(
  tx: TxDb,
  match: Match,
): Promise<StartLineupSummary[]> {
  const rosters = await tx
    .select()
    .from(matchRosters)
    .where(eq(matchRosters.matchId, match.id));
  const rosterByTeam = new Map(rosters.map((row) => [row.teamId, row]));

  const summaries: StartLineupSummary[] = [];
  for (const teamId of [match.teamAId, match.teamBId]) {
    const roster = rosterByTeam.get(teamId);
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
      .select({ teamMemberId: matchRosterPlayers.teamMemberId, isStarter: matchRosterPlayers.isStarter })
      .from(matchRosterPlayers)
      .where(eq(matchRosterPlayers.rosterId, roster.id));
    const { starterIds, substituteIds } = loadPersistedPlayers(players);

    await assertStartingLineupAllowedInTx(tx, { match, teamId, starterIds, substituteIds });
    summaries.push({ rosterId: roster.id, matchId: match.id, teamId, starterIds, substituteIds, status: "confirmed" });
  }
  return summaries;
}
