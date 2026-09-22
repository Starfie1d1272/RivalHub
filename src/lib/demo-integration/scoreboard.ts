import type { RivalHubEvidenceSubmission } from "./contracts";

export type ScoreboardStatField = "kills" | "deaths" | "assists" | "hsPercent" | "firstKills" | "multiKills" | "clutches" | "adr";
type PlayerMapSummary = RivalHubEvidenceSubmission["summaries"]["playerMaps"][number];

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Project the producer-owned player-map summary into RivalHub scoreboard columns. */
export function dakStableScoreboardValues(summary: PlayerMapSummary): Record<ScoreboardStatField, number> {
  return {
    kills: summary.kills,
    deaths: summary.deaths,
    assists: summary.assists,
    hsPercent: summary.kills > 0 ? Math.round((summary.headshots / summary.kills) * 100) : 0,
    firstKills: summary.firstKills,
    multiKills: summary.twoKillRounds + summary.threeKillRounds + summary.fourKillRounds + summary.fiveKillRounds,
    clutches: summary.clutchWins,
    adr: round(summary.damage / Math.max(summary.rounds, 1), 2),
  };
}
