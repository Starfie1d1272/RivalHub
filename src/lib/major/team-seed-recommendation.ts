import type { CompetitiveProfileConfig } from "@/types/season";
import { getPlayerStrengthBreakdown, type PlayerStrengthInput, type PlayerStrengthBreakdown } from "@/lib/major/player-strength";

export interface TeamSeedRecommendationInput { teamId: string; teamName: string; starters: PlayerStrengthInput[] }
export interface TeamSeedRecommendation { teamId: string; teamName: string; available: boolean; blockers: string[]; teamSeedStrength: number | null; recommendationRank: number | null; tieGroup: number | null; starters: Array<{ userId: string; label: string; breakdown: PlayerStrengthBreakdown }> }

export function buildTeamSeedRecommendations(teams: readonly TeamSeedRecommendationInput[], config: CompetitiveProfileConfig): TeamSeedRecommendation[] {
  const rows: TeamSeedRecommendation[] = teams.map((team) => {
    const starters = team.starters.map((player) => ({ userId: player.userId, label: player.label, breakdown: getPlayerStrengthBreakdown(player, config) }));
    const blockers = starters.flatMap((starter) => starter.breakdown.blockers.map((message) => `${starter.label}: ${message}`));
    if (starters.length !== 5) blockers.push("赛事级预定主力必须恰好为 5 人。");
    const available = blockers.length === 0 && starters.every((starter) => starter.breakdown.available);
    return { teamId: team.teamId, teamName: team.teamName, available, blockers, teamSeedStrength: available ? starters.reduce((sum, starter) => sum + starter.breakdown.weightedRank!, 0) / 5 : null, recommendationRank: null, tieGroup: null, starters };
  });
  const ranked = rows.filter((row) => row.available).sort((a, b) => a.teamSeedStrength! - b.teamSeedStrength! || a.teamName.localeCompare(b.teamName) || a.teamId.localeCompare(b.teamId));
  let rank = 0; let previous: number | null = null; let tieGroup = 0;
  for (const row of ranked) { rank += 1; if (previous === null || row.teamSeedStrength !== previous) tieGroup += 1; row.recommendationRank = previous !== null && row.teamSeedStrength === previous ? rank - 1 : rank; row.tieGroup = tieGroup; previous = row.teamSeedStrength; }
  return rows;
}
