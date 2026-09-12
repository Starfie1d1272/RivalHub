import { describe, expect, it } from "vitest";
import { projectStrengthStarter, projectStrengthTeams } from "./strength";

type RawStarter = Parameters<typeof projectStrengthStarter>[0];
type RawTeam = Parameters<typeof projectStrengthTeams>[0][number];

function starter(userId: string): RawStarter {
  const fact = { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null };
  return {
    userId,
    label: userId,
    input: { historicalPeak: fact, previousSeasonPeak: fact, currentSeasonPeak: fact },
    breakdown: {
      available: true,
      blockers: [],
      weightedRank: 12.34,
      historicalValue: 12,
      previousValue: 12,
      currentValue: 13,
      effectiveRecentPeak: { ...fact, rank: "A++" },
      historicalRating: 1000,
    },
  };
}

function team(teamId: string, tieGroup: number | null, recommendationRank: number | null): RawTeam {
  return {
    teamId,
    teamName: teamId,
    available: recommendationRank !== null,
    blockers: recommendationRank === null ? ["资料不足"] : [],
    teamSeedStrength: recommendationRank === null ? null : 12.34,
    teamSeedStrengthScaled: recommendationRank === null ? null : 1234,
    recommendationRank,
    tieGroup,
    displayOrder: recommendationRank,
    starters: recommendationRank === null ? [] : [starter(`${teamId}-player`)],
  };
}

describe("season workspace strength projection", () => {
  it("exposes evidence and semantic tie state without evaluator internals", () => {
    const [tied, tiedAgain, unique, unavailable] = projectStrengthTeams([
      team("tied-a", 1, 1),
      team("tied-b", 1, 1),
      team("unique", 2, 3),
      team("unavailable", null, null),
    ]);

    expect(tied?.tieState).toBe("tied");
    expect(tiedAgain?.tieState).toBe("tied");
    expect(unique?.tieState).toBe("not_tied");
    expect(unavailable?.tieState).toBe("not_ranked");
    expect(tied?.starters[0]?.presentation).toMatchObject({
      historicalPeak: { rank: "A" },
      referenceSeasonPeak: { rank: "A" },
      recentPeak: { rank: "A++" },
    });
    expect(tied).not.toHaveProperty("teamSeedStrength");
    expect(tied).not.toHaveProperty("tieGroup");
    expect(tied?.starters[0]).not.toHaveProperty("breakdown");
    expect(tied?.starters[0]?.presentation).not.toHaveProperty("weightedRank");
    expect(tied?.starters[0]?.presentation).not.toHaveProperty("historicalValue");
  });
});
