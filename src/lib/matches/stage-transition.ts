import type { CompetitionEntry } from "@/db/schema/competition-entries";
import { getPreviousStage } from "@/lib/seasons/compatibility";
import type { QualifiedTeam, StageConfig, StagePlan } from "@/types/season";

export type StageTransitionReadiness =
  | "ready"
  | "first_stage"
  | "previous_stage_incomplete"
  | "already_initialized"
  | "invalid_entrant_count";

export interface StageEntrantSeed {
  entry: CompetitionEntry;
  stageSeed: number;
  source: "direct" | "qualified";
  qualifier: QualifiedTeam | null;
}

export interface StageTransitionTopology {
  stage: StageConfig;
  previousStage: StageConfig | null;
  nextStage: StageConfig | null;
}

export interface StageTransitionBoundary {
  stage: StageConfig;
  previousStage: StageConfig | null;
  nextStage: StageConfig | null;
  qualifiers: QualifiedTeam[];
  orderedEntrants: StageEntrantSeed[];
  stageEntries: CompetitionEntry[];
  readiness: StageTransitionReadiness;
}

/** Resolve only the logical stage topology; no entrant or readiness facts are read. */
export function resolveStageTransitionTopology(input: {
  stagePlan: StagePlan;
  stageKey: string;
}): StageTransitionTopology {
  const stageIndex = input.stagePlan.findIndex((stage) => stage.key === input.stageKey);
  const stage = input.stagePlan[stageIndex];
  if (!stage) throw new Error(`未知赛程阶段: ${input.stageKey}`);

  return {
    stage,
    previousStage: getPreviousStage(input.stagePlan, stage.key) ?? null,
    nextStage: input.stagePlan[stageIndex + 1] ?? null,
  };
}

function deriveStageEntrants(input: {
  topology: StageTransitionTopology;
  entries: CompetitionEntry[];
  qualifiers: QualifiedTeam[];
}): StageEntrantSeed[] {
  const { stage, previousStage } = input.topology;
  const entryById = new Map(input.entries.map((entry) => [entry.id, entry]));
  const qualifierIds = new Set(input.qualifiers.map((qualifier) => qualifier.teamId));
  const directEntries = (stage.entrySeeds ?? 0) > 0
    ? input.entries.filter((entry) => !qualifierIds.has(entry.id)).slice(0, stage.entrySeeds)
    : [];

  const directEntrants = directEntries.map((entry, index) => ({
    entry,
    stageSeed: index + 1,
    source: "direct" as const,
    qualifier: null,
  }));
  const qualifiedEntrants = input.qualifiers.flatMap((qualifier, index): StageEntrantSeed[] => {
    const entry = entryById.get(qualifier.teamId);
    if (!entry) return [];
    return [{
      entry,
      stageSeed: directEntrants.length + index + 1,
      source: "qualified" as const,
      qualifier,
    }];
  });

  if (previousStage) return [...directEntrants, ...qualifiedEntrants];

  const firstStageEntries = stage.seeds?.length
    ? input.entries.filter((_, index) => stage.seeds!.includes(index + 1))
    : input.entries.slice(0, stage.teamCount);
  return firstStageEntries.map((entry, index) => ({
    entry,
    stageSeed: index + 1,
    source: "direct" as const,
    qualifier: null,
  }));
}

function evaluateStageTransitionReadiness(input: {
  topology: StageTransitionTopology;
  orderedEntrants: StageEntrantSeed[];
  previousComplete?: boolean;
  existingMatchCount?: number;
}): StageTransitionReadiness {
  if (!input.topology.previousStage) return "first_stage";
  if (input.previousComplete === false) return "previous_stage_incomplete";
  if ((input.existingMatchCount ?? 0) > 0) return "already_initialized";
  if (input.orderedEntrants.length !== input.topology.stage.teamCount) return "invalid_entrant_count";
  return "ready";
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
  const topology = resolveStageTransitionTopology(input);
  const qualifiers = input.qualifiers ?? [];
  const orderedEntrants = deriveStageEntrants({ topology, entries: input.entries, qualifiers });
  return {
    ...topology,
    qualifiers,
    orderedEntrants,
    stageEntries: orderedEntrants.map(({ entry }) => entry),
    readiness: evaluateStageTransitionReadiness({
      topology,
      orderedEntrants,
      previousComplete: input.previousComplete,
      existingMatchCount: input.existingMatchCount,
    }),
  };
}
