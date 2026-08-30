import type { CompetitionEntry } from "@/db/schema/competition-entries";
import type { StageConfig, QualifiedTeam } from "@/types/season";

export interface StageExecutor {
  initialize(
    seasonId: string,
    config: StageConfig,
    teams: CompetitionEntry[],
    qualifiers?: QualifiedTeam[],
  ): Promise<{ matchCount: number }>;
  getQualifiers(seasonId: string, config: StageConfig): Promise<QualifiedTeam[]>;
  advanceRound?(seasonId: string, stageKey: string): Promise<{ matchCount: number }>;
  isComplete(seasonId: string, stageKey: string): Promise<boolean>;
}
