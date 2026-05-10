import type { Team } from "@/db/schema/teams";
import type { StageConfig, QualifiedTeam } from "@/types/season";

export interface StageExecutor {
  initialize(
    seasonId: string,
    config: StageConfig,
    teams: Team[],
    qualifiers?: QualifiedTeam[],
  ): Promise<{ matchCount: number }>;
  getQualifiers(seasonId: string, config: StageConfig): Promise<QualifiedTeam[]>;
  advanceRound?(seasonId: string, stageKey: string): Promise<{ matchCount: number }>;
  isComplete(seasonId: string, stageKey: string): Promise<boolean>;
}
