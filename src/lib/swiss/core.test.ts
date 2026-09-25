import { describe, expect, it } from "vitest";
import { projectSwissStage } from "./core";
import {
  generateDirectBo3QualificationPairings,
  generateShortSwissRoundPairings,
  projectShortSwissStage,
} from "@/lib/competition-qualification/swiss";
import type { SwissCompletedMatch, SwissEntrant } from "./types";

function entrants(count: number): SwissEntrant[] {
  return Array.from({ length: count }, (_, index) => ({ teamId: `team-${index + 1}`, initialSeed: index + 1 }));
}

describe("generic Swiss core", () => {
  it("projects W/L, current Buchholz order, and threshold status from canonical results", () => {
    const teams = entrants(4);
    const projection = projectSwissStage({
      entrants: teams,
      matches: [
        { matchId: "a", round: 1, entryAId: "team-1", entryBId: "team-3", winnerId: "team-1" },
        { matchId: "b", round: 1, entryAId: "team-2", entryBId: "team-4", winnerId: "team-2" },
      ],
      completedRound: 1,
      config: { winThreshold: 1, lossThreshold: 1 },
    });
    expect(projection.advanced.map((team) => team.teamId)).toEqual(["team-1", "team-2"]);
    expect(projection.eliminated.map((team) => team.teamId)).toEqual(["team-3", "team-4"]);
    expect(projection.isComplete).toBe(true);
  });

  it("generates 12-team Swiss round one as P1vP7 through P6vP12 and completes in 15 matches", () => {
    const teams = entrants(12);
    let completedMatches: SwissCompletedMatch[] = [];
    let completedRound = 0;
    let matchNumber = 0;
    let projection = projectSwissStage({ entrants: teams, matches: [], completedRound, config: { winThreshold: 2, lossThreshold: 2 } });
    let roundOne: ReturnType<typeof generateShortSwissRoundPairings> = [];
    let totalMatches = 0;

    while (!projection.isComplete && completedRound < 5) {
      const pairings = generateShortSwissRoundPairings({ entrants: teams, matches: completedMatches, completedRound });
      if (completedRound === 0) roundOne = pairings;
      totalMatches += pairings.length;
      completedMatches = [...completedMatches, ...pairings.map((pairing) => ({
        matchId: `match-${++matchNumber}`,
        round: pairing.round,
        entryAId: pairing.higherSeedTeamId,
        entryBId: pairing.lowerSeedTeamId,
        winnerId: pairing.higherSeedTeamId,
      }))];
      completedRound += 1;
      projection = projectSwissStage({ entrants: teams, matches: completedMatches, completedRound, config: { winThreshold: 2, lossThreshold: 2 } });
    }

    expect(roundOne.map(({ higherSeed, lowerSeed }) => [higherSeed, lowerSeed])).toEqual([
      [1, 7], [2, 8], [3, 9], [4, 10], [5, 11], [6, 12],
    ]);
    expect(totalMatches).toBe(15);
    expect(completedRound).toBe(3);
    expect(projection.advanced).toHaveLength(6);
    expect(projection.eliminated).toHaveLength(6);
  });

  it("accepts partial and cross-record results in the generic projection", () => {
    const partial = projectSwissStage({
      entrants: entrants(4),
      matches: [{ matchId: "partial", round: 1, entryAId: "team-1", entryBId: "team-4", winnerId: "team-1" }],
      completedRound: 1,
      config: { winThreshold: 3, lossThreshold: 3 },
    });
    expect(partial.teams.find((team) => team.teamId === "team-1")?.wins).toBe(1);
    expect(partial.active).toHaveLength(4);

    const matches = [
      { matchId: "a", round: 1, entryAId: "team-1", entryBId: "team-3", winnerId: "team-1" },
      { matchId: "b", round: 1, entryAId: "team-2", entryBId: "team-4", winnerId: "team-4" },
      { matchId: "c", round: 2, entryAId: "team-1", entryBId: "team-2", winnerId: "team-1" },
      { matchId: "d", round: 2, entryAId: "team-3", entryBId: "team-4", winnerId: "team-3" },
    ];
    const projection = projectSwissStage({
      entrants: entrants(4),
      matches,
      completedRound: 2,
      config: { winThreshold: 3, lossThreshold: 3 },
    });
    expect(projection.teams.find((team) => team.teamId === "team-1")?.wins).toBe(2);
  });

  it("keeps complete-round and same-record checks in the Short Swiss consumer", () => {
    expect(() => projectShortSwissStage({
      entrants: entrants(4),
      matches: [{ matchId: "partial", round: 1, entryAId: "team-1", entryBId: "team-4", winnerId: "team-1" }],
      completedRound: 1,
    })).toThrow(/every active team/);

    const crossRecord = [
      { matchId: "a", round: 1, entryAId: "team-1", entryBId: "team-3", winnerId: "team-1" },
      { matchId: "b", round: 1, entryAId: "team-2", entryBId: "team-4", winnerId: "team-4" },
      { matchId: "c", round: 2, entryAId: "team-1", entryBId: "team-2", winnerId: "team-1" },
      { matchId: "d", round: 2, entryAId: "team-3", entryBId: "team-4", winnerId: "team-3" },
    ];
    expect(() => projectShortSwissStage({ entrants: entrants(4), matches: crossRecord, completedRound: 2 }))
      .toThrow(/cross-record/);
  });

  it("pairs Direct BO3 qualification as a high-low mirror draw", () => {
    expect(generateDirectBo3QualificationPairings(entrants(4)).map(({ higherSeed, lowerSeed }) => [higherSeed, lowerSeed]))
      .toEqual([[1, 4], [2, 3]]);
  });
});
