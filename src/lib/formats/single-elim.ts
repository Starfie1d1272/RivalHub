import { doubleElimExecutor } from "./double-elim";
import type { StageExecutor } from "./types";

export const singleElimExecutor: StageExecutor = {
  initialize(seasonId, config, teams, _qualifiers) {
    return doubleElimExecutor.initialize(seasonId, config, teams, _qualifiers);
  },
  isComplete: doubleElimExecutor.isComplete,
  async getQualifiers(_seasonId, _config) {
    return [];
  },
};
