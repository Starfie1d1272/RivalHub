import { and, eq, ne } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  majorFinalResults,
  majorStageRuns,
  matches,
  type Match,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { validateSeriesScore } from "@/lib/matches/result-rules";

/**
 * G2 managed result correction & recovery.
 *
 * matches stays the canonical result truth. A correction never silently
 * rewrites derived facts: the caller plans the correction, sees the downstream
 * impact, and explicitly confirms recovery. Downstream matches that already
 * started or finished always fail closed toward adjudication instead of being
 * rewritten.
 */

export interface ResultCorrectionProposal {
  scoreA: number;
  scoreB: number;
  /** Marks the corrected fact as a forfeit result (skips normal series shape). */
  isForfeit?: boolean;
}

export interface CorrectionPlanImpact {
  kind: "downstream_match" | "stage_run_rollback";
  matchId?: string;
  managedKey?: string | null;
  entryRound?: string | null;
  round?: number | null;
  status: string;
  description: string;
}

export interface ResultCorrectionPlan {
  matchId: string;
  stageKey: string | null;
  stageType: "swiss" | "single_elim" | null;
  current: { scoreA: number | null; scoreB: number | null; isForfeit: boolean };
  proposed: { scoreA: number; scoreB: number; isForfeit: boolean };
  currentWinnerTeamId: string | null;
  proposedWinnerTeamId: string;
  winnerChanges: boolean;
  affectsManagedRun: boolean;
  /** Derived facts that must be invalidated before the correction can rebuild. */
  impacts: CorrectionPlanImpact[];
  /** Non-empty means the correction is refused outright (fail closed). */
  blockedReasons: string[];
  /** Operator steps still required after applying (e.g. regenerate rounds). */
  requiredRecoveryActions: string[];
}

interface FrozenRunFacts {
  stageKey: string;
  stageType: "swiss" | "single_elim";
  stagePlanKeys: string[];
  finalizedRoundValue: number;
}

const PLAYOFF_STEPS = ["quarterfinal", "semifinal", "final"] as const;

/** Minimal shape the downstream classifier needs from a managed match row. */
export interface DownstreamCandidateRow {
  id: string;
  managedKey: string | null;
  entryRound: string | null;
  round: number | null;
  status: string;
}

export interface DownstreamImpactItem {
  matchId: string;
  managedKey: string | null;
  status: string;
  invalidatable: boolean;
  description: string;
}

/**
 * Pure classifier for within-run downstream facts. Swiss pairings ripple
 * through whole standings buckets, so EVERY later-round managed match counts —
 * not only those whose participants happen to change.
 */
export function classifyDownstreamManagedMatches(
  candidates: readonly DownstreamCandidateRow[],
  sourceMatch: { id: string; round: number | null; entryRound: string | null },
  stageType: "swiss" | "single_elim",
): DownstreamImpactItem[] {
  const isSwiss = stageType === "swiss";
  const myStepIndex =
    !isSwiss && sourceMatch.entryRound
      ? PLAYOFF_STEPS.indexOf(sourceMatch.entryRound as (typeof PLAYOFF_STEPS)[number])
      : -1;

  const impacts: DownstreamImpactItem[] = [];
  for (const candidate of candidates) {
    if (candidate.id === sourceMatch.id) continue;
    const isDownstream = isSwiss
      ? candidate.round !== null && sourceMatch.round !== null && candidate.round > sourceMatch.round
      : candidate.entryRound !== null &&
        candidate.entryRound !== "third_place" &&
        myStepIndex >= 0 &&
        PLAYOFF_STEPS.indexOf(candidate.entryRound as (typeof PLAYOFF_STEPS)[number]) > myStepIndex;
    if (!isDownstream) continue;

    const invalidatable = candidate.status === "scheduled";
    impacts.push({
      matchId: candidate.id,
      managedKey: candidate.managedKey,
      status: candidate.status,
      invalidatable,
      description: invalidatable
        ? `${candidate.managedKey ?? candidate.id} 需要在胜者变更后作废并重建（对阵可能随积分重排）。`
        : `${candidate.managedKey ?? candidate.id} 已经开始或完成（${candidate.status}），禁止自动改写。`,
    });
  }
  return impacts;
}

/**
 * The acceptance cursor a swiss correction must roll back to, or null when no
 * accepted round is affected (nothing was finalized beyond the corrected one).
 */
export function deriveSwissFinalizedRollback(
  runFinalizedRound: number,
  correctedRound: number | null,
): number | null {
  const target = Math.min(runFinalizedRound, Math.max(0, (correctedRound ?? 1) - 1));
  return target < runFinalizedRound ? target : null;
}

export function loadFrozenRunFacts(
  stageRun: Pick<typeof majorStageRuns.$inferSelect, "stageKey" | "ruleSnapshot" | "finalizedRound">,
): FrozenRunFacts {
  const snapshot = stageRun.ruleSnapshot as Record<string, unknown> | null;
  const stage =
    snapshot && typeof snapshot === "object"
      ? (snapshot.stage as { key?: unknown; type?: unknown } | undefined)
      : undefined;
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof stage?.key !== "string" ||
    stage.key !== stageRun.stageKey ||
    (stage.type !== "swiss" && stage.type !== "single_elim")
  ) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 规则快照缺失或不可识别。");
  }
  const rawPlan = Array.isArray(snapshot.stagePlan) ? snapshot.stagePlan : [];
  const stagePlanKeys = rawPlan
    .map((entry) => (entry && typeof entry === "object" ? (entry as { key?: unknown }).key : undefined))
    .filter((key): key is string => typeof key === "string");
  return {
    stageKey: stageRun.stageKey,
    stageType: stage.type,
    stagePlanKeys,
    finalizedRoundValue: stageRun.finalizedRound,
  };
}

export function resolveWinnerTeamId(match: Pick<Match, "teamAId" | "teamBId" | "scoreA" | "scoreB">): string | null {
  if (match.scoreA === null || match.scoreB === null || match.scoreA === match.scoreB) return null;
  return match.scoreA > match.scoreB ? match.teamAId : match.teamBId;
}

const FORFEIT_WINNER_SCORE: Record<"bo1" | "bo3" | "bo5", number> = {
  bo1: 13,
  bo3: 2,
  bo5: 3,
};

/**
 * A corrected fact must either be a normal legal series result or an explicit
 * forfeit result in the canonical forfeit shape (loser keeps 0).
 */
export function validateResultCorrectionProposal(
  match: Pick<Match, "format" | "isForfeit"> & { teamAId: string; teamBId: string },
  proposal: ResultCorrectionProposal,
): { winnerTeamId: string; isForfeit: boolean } {
  const { scoreA, scoreB } = proposal;
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "比分必须为非负整数。");
  }
  if (scoreA === scoreB) {
    throw new AppError(ErrorCode.MATCH_INVALID_SCORE, "系列赛不能平局，必须分出胜负。");
  }
  const isForfeit = proposal.isForfeit ?? match.isForfeit;
  if (isForfeit) {
    const expectedWinnerScore = FORFEIT_WINNER_SCORE[match.format];
    const loserScore = Math.min(scoreA, scoreB);
    const winnerScore = Math.max(scoreA, scoreB);
    if (winnerScore !== expectedWinnerScore || loserScore !== 0) {
      throw new AppError(
        ErrorCode.MATCH_INVALID_SCORE,
        `弃赛判负的标准比分为 ${expectedWinnerScore}:0（${match.format.toUpperCase()}）。`,
      );
    }
  } else {
    try {
      validateSeriesScore(match.format, scoreA, scoreB);
    } catch (error) {
      throw error instanceof AppError
        ? error
        : new AppError(ErrorCode.MATCH_INVALID_SCORE, "提议比分不合法。");
    }
  }
  return { winnerTeamId: scoreA > scoreB ? match.teamAId : match.teamBId, isForfeit };
}

/**
 * Computes the downstream impact inventory of correcting one finished managed
 * match. Read-only; call inside the transaction that will later apply so the
 * plan cannot drift between display and confirmation.
 */
export async function planResultCorrectionInTx(
  tx: TxDb,
  args: { matchId: string; proposal: ResultCorrectionProposal },
): Promise<ResultCorrectionPlan> {
  const [match] = await tx.select().from(matches).where(eq(matches.id, args.matchId)).for("update");
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
  if (match.status !== "finished") {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只能修正已结束的比赛结果。");
  }

  const proposed = validateResultCorrectionProposal(match, args.proposal);
  const currentWinner = resolveWinnerTeamId(match);
  const winnerChanges =
    currentWinner !== null && currentWinner !== proposed.winnerTeamId;

  const plan: ResultCorrectionPlan = {
    matchId: match.id,
    stageKey: null,
    stageType: null,
    current: {
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      isForfeit: match.isForfeit,
    },
    proposed: { scoreA: args.proposal.scoreA, scoreB: args.proposal.scoreB, isForfeit: proposed.isForfeit },
    currentWinnerTeamId: currentWinner,
    proposedWinnerTeamId: proposed.winnerTeamId,
    winnerChanges,
    affectsManagedRun: false,
    impacts: [],
    blockedReasons: [],
    requiredRecoveryActions: [],
  };

  if (!winnerChanges) {
    return plan;
  }

  if (match.ownership !== "major_stage" || !match.majorStageRunId) {
    plan.blockedReasons.push(
      "非托管比赛的胜者更正会与既有赛程矛盾，必须通过赛事事故裁决处理。",
    );
    return plan;
  }

  plan.affectsManagedRun = true;
  const [run] = await tx.select().from(majorStageRuns).where(eq(majorStageRuns.id, match.majorStageRunId));
  if (!run) throw new AppError(ErrorCode.INTERNAL_ERROR, "托管比赛缺少对应的 StageRun。");
  const frozen = loadFrozenRunFacts(run);
  plan.stageKey = frozen.stageKey;
  plan.stageType = frozen.stageType;

  // Cross-stage hazard: any later stage materialized for this season means the
  // current stage's outcome already produced derived truth elsewhere.
  const allRuns = await tx.select().from(majorStageRuns).where(eq(majorStageRuns.seasonId, match.seasonId));
  const myIndex = frozen.stagePlanKeys.indexOf(frozen.stageKey);
  for (const other of allRuns) {
    if (other.id === run.id) continue;
    const otherIndex = frozen.stagePlanKeys.indexOf(other.stageKey);
    if (myIndex >= 0 && otherIndex > myIndex) {
      plan.blockedReasons.push(
        `后续阶段 ${other.stageKey} 已基于本阶段结果建立，不能自动重建；需要走赛后裁决。`,
      );
    }
  }

  // Any confirmed official result pins placements/honors: post-event territory.
  const [finalResult] = await tx
    .select({ id: majorFinalResults.id })
    .from(majorFinalResults)
    .where(eq(majorFinalResults.seasonId, match.seasonId));
  if (finalResult) {
    plan.blockedReasons.push("官方名次已经生成，胜者更正被禁止；请使用赛后裁决操作。");
  }

  // Within-run downstream: later rounds (swiss) or later elimination steps
  // (playoff). Every downstream managed match must be considered: swiss
  // pairings ripple through entire standings buckets, so even matches whose
  // participants did not change may be stale after regeneration.
  const isSwiss = frozen.stageType === "swiss";
  const runMatches = await tx.select().from(matches).where(and(eq(matches.majorStageRunId, run.id)));
  const downstream = classifyDownstreamManagedMatches(
    runMatches.map((row) => ({
      id: row.id,
      managedKey: row.managedKey,
      entryRound: row.entryRound,
      round: row.round,
      status: row.status,
    })),
    { id: match.id, round: match.round, entryRound: match.entryRound },
    frozen.stageType,
  );
  let startedDownstream = 0;
  for (const impact of downstream) {
    plan.impacts.push({
      kind: "downstream_match",
      matchId: impact.matchId,
      managedKey: impact.managedKey,
      entryRound: null,
      round: null,
      status: impact.status,
      description: impact.description,
    });
    if (!impact.invalidatable) startedDownstream += 1;
  }
  if (startedDownstream > 0) {
    plan.blockedReasons.push(
      `存在 ${startedDownstream} 场已经开始或完成的下游托管比赛，系统拒绝自动重写；需要走赛后裁决并人工恢复。`,
    );
  }

  if (isSwiss) {
    const targetRollback = deriveSwissFinalizedRollback(run.finalizedRound, match.round);
    if (targetRollback !== null) {
      plan.impacts.push({
        kind: "stage_run_rollback",
        status: `finalized_round:${run.finalizedRound}`,
        description: `第 ${targetRollback + 1} 轮及之后的轮次确认将被撤销（finalizedRound ${run.finalizedRound} → ${targetRollback}）。`,
      });
      plan.requiredRecoveryActions.push(`从第 ${targetRollback + 1} 轮开始重新逐轮确认（finalize）以重建后续对阵。`);
    }
  } else {
    plan.requiredRecoveryActions.push("重新按顺序确认受影响的淘汰轮次以重建后续对阵。");
  }

  if (plan.impacts.length > 0) {
    plan.requiredRecoveryActions.unshift("显式作废列出的未开始下游托管比赛。");
  }

  return plan;
}

function assertPlanApplicable(plan: ResultCorrectionPlan): void {
  if (plan.blockedReasons.length > 0) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `该更正触发了 fail-closed 保护：${plan.blockedReasons.join("；")}`,
    );
  }
}

export interface AppliedResultCorrection {
  alreadyApplied: boolean;
  winnerChanged: boolean;
  invalidatedDownstreamMatches: string[];
  rolledBackToFinalized: number | null;
}

/**
 * Applies a planned correction atomically. Winner changes require
 * `confirmRecovery` and an empty hard-block set; unstarted downstream managed
 * matches are explicitly invalidated and the StageRun acceptance cursor is
 * rolled back so the operator can rebuild through the ordinary finalize path.
 */
export async function applyResultCorrectionInTx(
  tx: TxDb,
  args: {
    matchId: string;
    proposal: ResultCorrectionProposal;
    actorId: string;
    confirmRecovery?: boolean;
  },
): Promise<AppliedResultCorrection> {
  const plan = await planResultCorrectionInTx(tx, { matchId: args.matchId, proposal: args.proposal });

  if (
    plan.current.scoreA === plan.proposed.scoreA &&
    plan.current.scoreB === plan.proposed.scoreB &&
    plan.current.isForfeit === plan.proposed.isForfeit
  ) {
    return {
      alreadyApplied: true,
      winnerChanged: false,
      invalidatedDownstreamMatches: [],
      rolledBackToFinalized: null,
    };
  }

  assertPlanApplicable(plan);
  if (plan.winnerChanges) {
    if (!plan.affectsManagedRun) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "非托管比赛不允许通过更正改变胜者。");
    }
    if (!args.confirmRecovery) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        "该更正会改变胜者并影响下游事实：必须先查看影响清单并显式确认恢复流程。",
      );
    }
  }

  const [locked] = await tx.select().from(matches).where(eq(matches.id, args.matchId)).for("update");
  if (!locked) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");

  await tx
    .update(matches)
    .set({
      scoreA: plan.proposed.scoreA,
      scoreB: plan.proposed.scoreB,
      isForfeit: plan.proposed.isForfeit,
      updatedAt: new Date(),
    })
    .where(eq(matches.id, args.matchId));

  const applied: AppliedResultCorrection = {
    alreadyApplied: false,
    winnerChanged: plan.winnerChanges,
    invalidatedDownstreamMatches: [],
    rolledBackToFinalized: null,
  };

  await tx.insert(auditLogs).values({
    seasonId: locked.seasonId,
    action: "match.result.corrected",
    actorId: args.actorId,
    targetId: locked.id,
    targetType: "match",
    meta: {
      prevScoreA: locked.scoreA,
      prevScoreB: locked.scoreB,
      prevIsForfeit: locked.isForfeit,
      scoreA: plan.proposed.scoreA,
      scoreB: plan.proposed.scoreB,
      isForfeit: plan.proposed.isForfeit,
      winnerChanged: plan.winnerChanges,
      prevWinnerTeamId: plan.currentWinnerTeamId,
      nextWinnerTeamId: plan.proposedWinnerTeamId,
      stageKey: plan.stageKey,
      stageType: plan.stageType,
    },
  });

  if (!plan.winnerChanges) {
    return applied;
  }

  // Explicit invalidate phase for unstarted downstream managed matches.
  const invalidatable = plan.impacts.filter(
    (impact): impact is CorrectionPlanImpact & { matchId: string } =>
      impact.kind === "downstream_match" && impact.matchId !== undefined && impact.status === "scheduled",
  );
  for (const impact of invalidatable) {
    const deleted = await tx
      .delete(matches)
      .where(and(eq(matches.id, impact.matchId!), eq(matches.status, "scheduled")))
      .returning({ id: matches.id, managedKey: matches.managedKey });
    if (deleted.length === 0) continue;
    applied.invalidatedDownstreamMatches.push(deleted[0]!.id);
    await tx.insert(auditLogs).values({
      seasonId: locked.seasonId,
      action: "match.managed.invalidated",
      actorId: args.actorId,
      targetId: deleted[0]!.id,
      targetType: "match",
      meta: {
        reason: "upstream_result_correction",
        sourceMatchId: locked.id,
        managedKey: deleted[0]!.managedKey,
        stageKey: plan.stageKey,
      },
    });
  }

  // Roll back the acceptance cursor so finalize can rebuild deterministically.
  if (plan.stageType === "swiss" && locked.majorStageRunId) {
    const target = plan.impacts.find((impact) => impact.kind === "stage_run_rollback");
    if (target) {
      const rollbackTo = Math.max(0, (locked.round ?? 1) - 1);
      await tx
        .update(majorStageRuns)
        .set({ finalizedRound: rollbackTo })
        .where(and(eq(majorStageRuns.id, locked.majorStageRunId), ne(majorStageRuns.finalizedRound, rollbackTo)));
      applied.rolledBackToFinalized = rollbackTo;
      await tx.insert(auditLogs).values({
        seasonId: locked.seasonId,
        action: "major.stage.finalized_round.revoked",
        actorId: args.actorId,
        targetId: locked.majorStageRunId,
        targetType: "major_stage_run",
        meta: { stageKey: plan.stageKey, revokedFrom: target.status, rolledBackTo: rollbackTo },
      });
    }
  }

  return applied;
}

/**
 * Audits an out-of-band recovery decision for cases the engine refuses to
 * touch (started downstream facts, later stages, post-event results). This
 * records the fact that an adjudication happened and who made it — it never
 * mutates canonical results by itself.
 */
export async function recordRecoveryAdjudicationInTx(
  tx: TxDb,
  args: { matchId: string; actorId: string; note: string },
): Promise<{ recorded: true }> {
  const [locked] = await tx.select().from(matches).where(eq(matches.id, args.matchId)).for("update");
  if (!locked) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
  if (!args.note.trim()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "裁决说明不能为空。");
  }
  await tx.insert(auditLogs).values({
    seasonId: locked.seasonId,
    action: "match.recovery.adjudicated",
    actorId: args.actorId,
    targetId: locked.id,
    targetType: "match",
    meta: {
      note: args.note.trim(),
      stageKey: locked.stage,
      scoreA: locked.scoreA,
      scoreB: locked.scoreB,
      isForfeit: locked.isForfeit,
    },
  });
  return { recorded: true };
}
