import { AppError, ErrorCode } from "@/lib/errors";
import type { StageType } from "@/types/season";
import type { StageExecutor } from "./types";
import { roundRobinExecutor } from "./round-robin";
import { doubleElimExecutor } from "./double-elim";
import { singleElimExecutor } from "./single-elim";
import { swissExecutor } from "./swiss";

const EXECUTORS: Partial<Record<StageType, StageExecutor>> = {
  round_robin: roundRobinExecutor,
  double_elim: doubleElimExecutor,
  single_elim: singleElimExecutor,
  swiss: swissExecutor,
};

export function getExecutor(type: StageType): StageExecutor {
  const executor = EXECUTORS[type];
  if (!executor) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, `未知赛制: ${type}`);
  }
  return executor;
}
