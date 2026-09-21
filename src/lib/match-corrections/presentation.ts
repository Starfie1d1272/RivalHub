import { presentMatchCorrectionBlocker } from "@/lib/match-corrections/errors";
import type {
  CorrectionPlanImpact,
  CorrectionRecoveryAction,
  ResultCorrectionPlan,
} from "@/lib/match-corrections/service";

export interface ResultCorrectionPlanPresentation {
  current: ResultCorrectionPlan["current"];
  proposed: ResultCorrectionPlan["proposed"];
  winnerChanges: boolean;
  affectsManagedRun: boolean;
  impacts: Array<{ label: string }>;
  blockedReasons: string[];
  requiredRecoveryActions: string[];
}

const IMPACT_MESSAGES = {
  downstreamInvalidatable: "一场尚未开始的下游比赛将被作废并重建。",
  downstreamStarted: "一场已经开始或完成的下游比赛无法自动改写。",
  downstreamUnknown: "一场下游淘汰赛的依赖无法确认，系统不会自动改写。",
} as const;

function presentImpact(impact: CorrectionPlanImpact): string {
  if (impact.kind === "stage_run_rollback") {
    return `第 ${impact.fromRound} 轮及之后的赛程确认将被撤销。`;
  }
  if (!impact.dependencyKnown) return IMPACT_MESSAGES.downstreamUnknown;
  return impact.invalidatable ? IMPACT_MESSAGES.downstreamInvalidatable : IMPACT_MESSAGES.downstreamStarted;
}

function presentRecoveryAction(action: CorrectionRecoveryAction): string {
  switch (action.code) {
    case "invalidateDownstreamMatches":
      return `应用更正前，系统会作废 ${action.params.count} 场尚未开始的下游比赛。`;
    case "rebuildSwissRounds":
      return `从第 ${action.params.fromRound} 轮开始重新确认赛程，直到后续对阵恢复。`;
    case "rebuildPlayoffRounds":
      return "按顺序重新确认受影响的淘汰赛轮次，重建后续对阵。";
  }
}

/**
 * Projects correction facts into the only shape the operator panel needs.
 * Identifiers, raw statuses, stage keys and diagnostic fields stay server-side.
 */
export function presentResultCorrectionPlan(plan: ResultCorrectionPlan): ResultCorrectionPlanPresentation {
  return {
    current: plan.current,
    proposed: plan.proposed,
    winnerChanges: plan.winnerChanges,
    affectsManagedRun: plan.affectsManagedRun,
    impacts: plan.impacts.map((impact) => ({ label: presentImpact(impact) })),
    blockedReasons: plan.blockedReasons.map(presentMatchCorrectionBlocker),
    requiredRecoveryActions: plan.requiredRecoveryActions.map(presentRecoveryAction),
  };
}
