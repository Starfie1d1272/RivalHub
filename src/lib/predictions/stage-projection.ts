import type { StagePlan } from "@/types/season";
import { resolveStageTransitionTopology } from "@/lib/matches/stage-transition";
import { directSeedRange } from "@/lib/major/seeding";
import type { PublicStage } from "./types";

/** Convert the canonical frozen plan once; consumers traverse keys, never array positions. */
export function projectPredictionStages(plan: StagePlan): PublicStage[] {
  return plan.map((stage) => {
    const { previousStage, nextStage } = resolveStageTransitionTopology({
      stagePlan: plan,
      stageKey: stage.key,
    });
    if (
      (stage.type !== "swiss" && stage.type !== "single_elim") ||
      (stage.matchFormat !== "bo1" && stage.matchFormat !== "bo3")
    )
      throw new Error("暂不支持该阶段规则");
    return {
      key: stage.key,
      name: stage.name,
      type: stage.type,
      matchFormat: stage.matchFormat,
      entrySeeds: stage.entrySeeds ?? 0,
      finalFormat: stage.finalFormat === "bo5" ? "bo5" : null,
      previousKey: previousStage?.key ?? null,
      nextKey: nextStage?.key ?? null,
      directSeeds: directSeedRange(
        plan,
        stage.key,
        previousStage ? (stage.entrySeeds ?? 0) : stage.teamCount,
      ),
    };
  });
}

export function orderedPredictionStages(
  stages: readonly PublicStage[],
): PublicStage[] {
  const roots = stages.filter((stage) => stage.previousKey === null);
  if (roots.length !== 1) throw new Error("Invalid prediction stage topology");
  const ordered: PublicStage[] = [];
  let stage: PublicStage | undefined = roots[0];
  while (stage) {
    if (ordered.some((s) => s.key === stage!.key))
      throw new Error("Cyclic stage topology");
    ordered.push(stage);
    const next: PublicStage | undefined = stages.find(
      (s) => s.key === stage!.nextKey,
    );
    if (stage.nextKey && (!next || next.previousKey !== stage.key))
      throw new Error("Broken stage transition");
    stage = next;
  }
  if (ordered.length !== stages.length)
    throw new Error("Disconnected stage topology");
  return ordered;
}
