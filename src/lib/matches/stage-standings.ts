import type { CompetitionEntry } from "@/db/schema/competition-entries";
import type { Match } from "@/db/schema/matches";
import { resolveStrictHistoricalRoundRobinEntryIds } from "@/lib/matches/historical-round-robin";
import { calculateStandings, type MatchRoundScore, type TeamStanding } from "@/lib/standings";
import type { StageConfig } from "@/types/season";

/**
 * Stage-local round-robin standings projection shared by public/admin reads
 * and external event projections.  A season-wide match set is never an input
 * authority here: entrant ids come from the stage provider state, with the
 * strict historical recovery path retained only for legacy complete stages.
 */
export function calculateStageRoundRobinStandings(input: {
  stage: Pick<StageConfig, "type" | "teamCount">;
  stageMatches: readonly Match[];
  entries: readonly CompetitionEntry[];
  roundScoresByMatchId: ReadonlyMap<string, readonly MatchRoundScore[]>;
  stageEntrantIds?: readonly string[];
}): TeamStanding[] {
  const { stage, stageMatches, entries, roundScoresByMatchId, stageEntrantIds } = input;
  if (stage.type !== "round_robin" || stageMatches.length === 0) return [];

  const entryIds = stageEntrantIds && stageEntrantIds.length > 0
    ? [...stageEntrantIds]
    : resolveStrictHistoricalRoundRobinEntryIds(stage.teamCount, stageMatches);
  if (!entryIds) return [];

  const stageEntryIds = new Set(entryIds);
  return calculateStandings(
    entries.filter((entry) => stageEntryIds.has(entry.id)),
    stageMatches.filter((match) => match.status === "finished"),
    roundScoresByMatchId,
  );
}
