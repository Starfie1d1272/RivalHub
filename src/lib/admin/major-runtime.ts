import type { StagePlan } from "@/types/season";

export interface MajorSwissRuntimeData {
  seasonId: string;
  stageRunId: string;
  stageKey: string;
  finalizedRound: 0 | 1 | 2 | 3 | 4 | 5;
  currentRound: 1 | 2 | 3 | 4 | 5;
  currentMatchCount: number;
  completedMatchCount: number;
  stageComplete: boolean;
  nextStageName: string | null;
  nextStageType: "swiss" | "playoff" | null;
}

export interface MajorPlayoffRuntimeData {
  seasonId: string;
  stageRunId: string;
  currentRound: "quarterfinal" | "semifinal" | "final" | null;
  currentMatchCount: number;
  completedMatchCount: number;
  resultPendingConfirmation: boolean;
}

interface RuntimeMatch {
  majorStageRunId: string | null;
  ownership: string;
  round: number | null;
  entryRound: string | null;
  status: string;
}

interface RuntimeStageRun {
  id: string;
  stageKey: string;
  finalizedRound: number;
}

export function buildMajorRuntimeData({
  seasonId,
  stagePlan,
  stageRuns,
  matches,
  finalResultStatus,
}: {
  seasonId: string;
  stagePlan: StagePlan;
  stageRuns: RuntimeStageRun[];
  matches: RuntimeMatch[];
  finalResultStatus: string | null | undefined;
}): {
  swissRuntime: MajorSwissRuntimeData | null;
  playoffRuntime: MajorPlayoffRuntimeData | null;
} {
  const stageRun = [...stagePlan].reverse()
    .map((stage) => stageRuns.find((run) => run.stageKey === stage.key))
    .find((run) => run !== undefined) ?? null;
  const configuredStage = stageRun ? stagePlan.find((stage) => stage.key === stageRun.stageKey) : null;
  let swissRuntime: MajorSwissRuntimeData | null = null;
  let playoffRuntime: MajorPlayoffRuntimeData | null = null;

  if (stageRun && configuredStage?.type === "swiss" && isMajorSwissFinalizedRound(stageRun.finalizedRound)) {
    const finalizedRound = stageRun.finalizedRound;
    const currentRound = (finalizedRound === 5 ? 5 : finalizedRound + 1) as 1 | 2 | 3 | 4 | 5;
    const currentMatches = matches.filter((match) => match.majorStageRunId === stageRun.id && match.ownership === "major_stage" && match.round === currentRound);
    const nextStage = finalizedRound === 5
      ? stagePlan[stagePlan.findIndex((stage) => stage.key === stageRun.stageKey) + 1] ?? null
      : null;
    swissRuntime = {
      seasonId,
      stageRunId: stageRun.id,
      stageKey: stageRun.stageKey,
      finalizedRound,
      currentRound,
      currentMatchCount: currentMatches.length,
      completedMatchCount: currentMatches.filter((match) => match.status === "finished").length,
      stageComplete: finalizedRound === 5,
      nextStageName: nextStage?.name ?? null,
      nextStageType: nextStage?.type === "swiss" ? "swiss" : nextStage?.type === "single_elim" ? "playoff" : null,
    };
  }

  if (stageRun && configuredStage?.type === "single_elim") {
    const playoffMatches = matches.filter((match) => match.majorStageRunId === stageRun.id && match.ownership === "major_stage");
    const inRound = (round: "quarterfinal" | "semifinal" | "final") => playoffMatches.filter((match) => match.entryRound === round);
    const complete = (round: "quarterfinal" | "semifinal" | "final", count: number) => {
      const rows = inRound(round);
      return rows.length === count && rows.every((match) => match.status === "finished");
    };
    const currentRound = finalResultStatus === "pending_confirmation"
      ? null
      : !complete("quarterfinal", 4) ? "quarterfinal"
        : !complete("semifinal", 2) ? "semifinal"
          : "final";
    const currentMatches = currentRound ? inRound(currentRound) : [];
    playoffRuntime = {
      seasonId,
      stageRunId: stageRun.id,
      currentRound,
      currentMatchCount: currentMatches.length,
      completedMatchCount: currentMatches.filter((match) => match.status === "finished").length,
      resultPendingConfirmation: finalResultStatus === "pending_confirmation",
    };
  }

  return { swissRuntime, playoffRuntime };
}

function isMajorSwissFinalizedRound(value: number): value is 0 | 1 | 2 | 3 | 4 | 5 {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}
