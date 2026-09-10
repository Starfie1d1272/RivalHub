import type { CompetitionEntry } from "@/db/schema/competition-entries";
import { getPreviousStage } from "@/lib/seasons/compatibility";
import type { QualifiedTeam, StageConfig, StagePlan } from "@/types/season";

export type StageTransitionReadiness =
  | "ready"
  | "first_stage"
  | "previous_stage_incomplete"
  | "already_initialized"
  | "invalid_entrant_count";

export interface StageTransitionBoundary {
  stage: StageConfig;
  previousStage: StageConfig | null;
  nextStage: StageConfig | null;
  qualifiers: QualifiedTeam[];
  stageEntries: CompetitionEntry[];
  readiness: StageTransitionReadiness;
}

/**
 * The generic Stage transition boundary. UI and actions consume this result;
 * neither layer infers adjacent stages or reconstructs entrant membership.
 */
export function resolveStageTransitionBoundary(input: {
  stagePlan: StagePlan;
  stageKey: string;
  entries: CompetitionEntry[];
  qualifiers?: QualifiedTeam[];
  previousComplete?: boolean;
  existingMatchCount?: number;
}): StageTransitionBoundary {
  const stageIndex = input.stagePlan.findIndex((stage) => stage.key === input.stageKey);
  const stage = input.stagePlan[stageIndex];
  if (!stage) throw new Error(`未知赛程阶段: ${input.stageKey}`);

  const previousStage = getPreviousStage(input.stagePlan, stage.key) ?? null;
  const nextStage = input.stagePlan[stageIndex + 1] ?? null;
  const qualifiers = input.qualifiers ?? [];
  const qualifierIds = new Set(qualifiers.map((qualifier) => qualifier.teamId));
  const entryTeams = (stage.entrySeeds ?? 0) > 0
    ? input.entries.filter((entry) => !qualifierIds.has(entry.id)).slice(0, stage.entrySeeds)
    : [];
  const qualifiedTeams = input.entries.filter((entry) => qualifierIds.has(entry.id));
  const stageEntries = previousStage
    ? [...entryTeams, ...qualifiedTeams]
    : stage.seeds?.length
      ? input.entries.filter((_, index) => stage.seeds!.includes(index + 1))
      : input.entries.slice(0, stage.teamCount);

  let readiness: StageTransitionReadiness = "ready";
  if (!previousStage) readiness = "first_stage";
  else if (input.previousComplete === false) readiness = "previous_stage_incomplete";
  else if ((input.existingMatchCount ?? 0) > 0) readiness = "already_initialized";
  else if (stageEntries.length !== stage.teamCount) readiness = "invalid_entrant_count";

  return { stage, previousStage, nextStage, qualifiers, stageEntries, readiness };
}
