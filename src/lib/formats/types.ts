import type { Team } from "@/db/schema/teams";
import type { StageConfig } from "@/types/season";

export interface StageExecutor {
  initialize(
    seasonId: string,
    config: StageConfig,
    teams: Team[],
  ): Promise<{ matchCount: number }>;
  advanceRound?(seasonId: string, stageKey: string): Promise<{ matchCount: number }>;
  isComplete(seasonId: string, stageKey: string): Promise<boolean>;
}
