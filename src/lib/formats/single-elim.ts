import { doubleElimExecutor } from "./double-elim";
import type { StageExecutor } from "./types";

export const singleElimExecutor: StageExecutor = {
  initialize: doubleElimExecutor.initialize,
  isComplete: doubleElimExecutor.isComplete,
};
