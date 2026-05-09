import { doubleElimExecutor } from "./double-elim";
import type { StageExecutor } from "./types";

// double-elim 的 initialize 已通过 config.type 自动区分单/双败，
// isComplete 只查 match 状态不关心赛制，两者直接复用。
export const singleElimExecutor: StageExecutor = {
  initialize: doubleElimExecutor.initialize,
  isComplete: doubleElimExecutor.isComplete,
};
