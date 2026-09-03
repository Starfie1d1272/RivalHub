import type { StageType } from "@/types/season";

/** Stage types with active generic executors for custom competition definitions. */
const SUPPORTED_STAGE_TYPES = [
  "round_robin",
  "double_elim",
  "single_elim",
] as const satisfies readonly StageType[];

export function isStageExecutorSupported(type: StageType): boolean {
  return SUPPORTED_STAGE_TYPES.includes(type as (typeof SUPPORTED_STAGE_TYPES)[number]);
}
