import { describe, expect, it } from "vitest";
import {
  generateNextMajorSwissRound,
  getMajorSwissQualifiers,
  projectMajorSwissStage,
  type MajorSwissEntrant,
  type MajorSwissFinalizedRound,
  type MajorSwissMatchFact,
  type MajorSwissStageMatchFormat,
  type MajorSwissRound,
} from "./swiss";
import {
  seedMajorLaterStageEntrants,
  seedMajorStageOneEntrants,
  type MajorTournamentSeededTeam,
} from "./seeding";
import {
  generateMajorPlayoffQuarterfinals,
  seedMajorPlayoffEntrants,
  type MajorPlayoffMatchFact,
} from "./playoff";
import { buildFinalMajorPlacements, type MajorSwissStageFacts } from "./placement";

interface SimulatedStage extends MajorSwissStageFacts {
  qualifiers: ReturnType<typeof getMajorSwissQualifiers>;
}

interface GoldenMajor {
  tournamentTeams: readonly MajorTournamentSeededTeam[];
  stage1: SimulatedStage;
  stage2: SimulatedStage;
  stage3: SimulatedStage;
  playoffMatches: readonly MajorPlayoffMatchFact[];
  hasThirdPlaceMatch: boolean;
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function simulateSwissStage(
  label: string,
  entrants: readonly MajorSwissEntrant[],
  seed: number,
  stageMatchFormat: MajorSwissStageMatchFormat,
): SimulatedStage {
  const rng = makeRng(seed);
  const matches: MajorSwissMatchFact[] = [];

  for (let round = 1; round <= 5; round += 1) {
    const finalizedRound = (round - 1) as MajorSwissFinalizedRound;
    const pairings = generateNextMajorSwissRound({
      entrants,
      matches,
      finalizedRound,
      stageMatchFormat,
    });
    if (stageMatchFormat === "bo3") {
      expect(pairings.every((pairing) => pairing.format === "bo3")).toBe(true);
    }
    for (let index = 0; index < pairings.length; index += 1) {
      const pairing = pairings[index];
      matches.push({
        matchId: `${label}-r${round}-m${index + 1}`,
        round: round as MajorSwissRound,
        entryAId: pairing.higherSeedTeamId,
        entryBId: pairing.lowerSeedTeamId,
        winnerId:
          rng() < 0.5 ? pairing.higherSeedTeamId : pairing.lowerSeedTeamId,
      });
    }
  }

  const projection = projectMajorSwissStage({ entrants, matches, finalizedRound: 5 });
  return {
    entrants,
    matches,
    qualifiers: getMajorSwissQualifiers(projection),
  };
}

function createPlayoffMatches(
  stage3: SimulatedStage,
  hasThirdPlaceMatch: boolean,
): readonly MajorPlayoffMatchFact[] {
  const entrants = seedMajorPlayoffEntrants(stage3.qualifiers);
  const quarterfinalPairings = generateMajorPlayoffQuarterfinals(entrants);
  const quarterfinals: MajorPlayoffMatchFact[] = quarterfinalPairings.map((pairing) => ({
    matchId: `playoff-qf-${pairing.slot}`,
    round: "quarterfinal",
    slot: pairing.slot,
    entryAId: pairing.lowerSeedTeamId,
    entryBId: pairing.higherSeedTeamId,
    // Alternate upsets so the fixture exercises seed and Team A/B independence.
    winnerId: pairing.slot % 2 === 0 ? pairing.lowerSeedTeamId : pairing.higherSeedTeamId,
  }));

  const semifinals: MajorPlayoffMatchFact[] = [
    {
      matchId: "playoff-sf-1",
      round: "semifinal",
      slot: 1,
      entryAId: quarterfinals[0].winnerId,
      entryBId: quarterfinals[1].winnerId,
      winnerId: quarterfinals[1].winnerId,
    },
    {
      matchId: "playoff-sf-2",
      round: "semifinal",
      slot: 2,
      entryAId: quarterfinals[3].winnerId,
      entryBId: quarterfinals[2].winnerId,
      winnerId: quarterfinals[2].winnerId,
    },
  ];

  const final: MajorPlayoffMatchFact = {
    matchId: "playoff-final",
    round: "final",
    slot: 1,
    entryAId: semifinals[1].winnerId,
    entryBId: semifinals[0].winnerId,
    winnerId: semifinals[0].winnerId,
  };
  const thirdPlace: MajorPlayoffMatchFact = {
    matchId: "playoff-third-place",
    round: "third_place",
    slot: 1,
    entryAId: semifinals[0].winnerId === semifinals[0].entryAId
      ? semifinals[0].entryBId
      : semifinals[0].entryAId,
    entryBId: semifinals[1].winnerId === semifinals[1].entryAId
      ? semifinals[1].entryBId
      : semifinals[1].entryAId,
    winnerId: semifinals[0].winnerId === semifinals[0].entryAId
      ? semifinals[0].entryBId
      : semifinals[0].entryAId,
  };

  return [
    ...quarterfinals,
    ...semifinals,
    ...(hasThirdPlaceMatch ? [thirdPlace] : []),
    final,
  ];
}

function createGoldenMajor(hasThirdPlaceMatch = false): GoldenMajor {
  const tournamentTeams: MajorTournamentSeededTeam[] = Array.from(
    { length: 32 },
    (_, index) => ({ teamId: `team-${index + 1}`, tournamentSeed: index + 1 }),
  );

  const stage1 = simulateSwissStage(
    "stage1",
    seedMajorStageOneEntrants(tournamentTeams.filter((team) => team.tournamentSeed >= 17)),
    7,
    "bo1",
  );
  const stage2 = simulateSwissStage(
    "stage2",
    seedMajorLaterStageEntrants({
      directEntrants: tournamentTeams.filter(
        (team) => team.tournamentSeed >= 9 && team.tournamentSeed <= 16,
      ),
      advancingEntrants: stage1.qualifiers.map((qualifier) => ({
        teamId: qualifier.teamId,
        previousStageFinalSeed: qualifier.finalStageSeed,
      })),
    }),
    42,
    "bo1",
  );
  const stage3 = simulateSwissStage(
    "stage3",
    seedMajorLaterStageEntrants({
      directEntrants: tournamentTeams.filter((team) => team.tournamentSeed <= 8),
      advancingEntrants: stage2.qualifiers.map((qualifier) => ({
        teamId: qualifier.teamId,
        previousStageFinalSeed: qualifier.finalStageSeed,
      })),
    }),
    99,
    "bo3",
  );

  return {
    tournamentTeams,
    stage1,
    stage2,
    stage3,
    playoffMatches: createPlayoffMatches(stage3, hasThirdPlaceMatch),
    hasThirdPlaceMatch,
  };
}

function expectPlacementGroups(
  placements: ReturnType<typeof buildFinalMajorPlacements>,
  ranges: readonly (readonly [number, number])[],
): void {
  expect(placements.map(({ from, to }) => [from, to])).toEqual(ranges);
  expect(placements.every((group) => group.entryIds.length === group.to - group.from + 1)).toBe(true);
  expect(new Set(placements.flatMap((group) => group.entryIds)).size).toBe(32);
  expect(placements.flatMap((group) => group.entryIds)).toHaveLength(32);
  expect(placements.every((group) => !("rank" in group))).toBe(true);
}

function expectSwissEliminationGroups(
  major: GoldenMajor,
  placements: ReturnType<typeof buildFinalMajorPlacements>,
  stage: "stage1" | "stage2" | "stage3",
  ranges: readonly (readonly [number, number])[],
): void {
  const projection = projectMajorSwissStage({
    entrants: major[stage].entrants,
    matches: major[stage].matches,
    finalizedRound: 5,
  });
  for (const [index, wins] of [2, 1, 0].entries()) {
    const placement = placements.find(
      (group) => group.from === ranges[index][0] && group.to === ranges[index][1],
    )!;
    expect(new Set(placement.entryIds)).toEqual(new Set(
      projection.eliminated.filter((team) => team.wins === wins && team.losses === 3).map((team) => team.teamId),
    ));
  }
}

describe("golden 32-team Major domain simulation", () => {
  it("runs the 106-match no-third-place path and derives canonical placement groups", () => {
    const major = createGoldenMajor();
    const placements = buildFinalMajorPlacements(major);

    expect(major.stage1.matches).toHaveLength(33);
    expect(major.stage2.matches).toHaveLength(33);
    expect(major.stage3.matches).toHaveLength(33);
    expect(major.playoffMatches).toHaveLength(7);
    expect(
      major.stage1.matches.length +
        major.stage2.matches.length +
        major.stage3.matches.length +
        major.playoffMatches.length,
    ).toBe(106);

    expectPlacementGroups(placements, [
      [1, 1], [2, 2], [3, 4], [5, 8], [9, 11], [12, 14], [15, 16],
      [17, 19], [20, 22], [23, 24], [25, 27], [28, 30], [31, 32],
    ]);
    expectSwissEliminationGroups(major, placements, "stage3", [[9, 11], [12, 14], [15, 16]]);
    expectSwissEliminationGroups(major, placements, "stage2", [[17, 19], [20, 22], [23, 24]]);
    expectSwissEliminationGroups(major, placements, "stage1", [[25, 27], [28, 30], [31, 32]]);
    for (const group of placements) {
      const seeds = group.entryIds.map(
        (teamId) => major.tournamentTeams.find((team) => team.teamId === teamId)!.tournamentSeed,
      );
      expect(seeds).toEqual([...seeds].sort((a, b) => a - b));
    }
  });

  it("runs the 107-match third-place path and derives separate third and fourth groups", () => {
    const major = createGoldenMajor(true);
    const placements = buildFinalMajorPlacements(major);

    expect(major.playoffMatches).toHaveLength(8);
    expect(
      major.stage1.matches.length +
        major.stage2.matches.length +
        major.stage3.matches.length +
        major.playoffMatches.length,
    ).toBe(107);
    expectPlacementGroups(placements, [
      [1, 1], [2, 2], [3, 3], [4, 4], [5, 8], [9, 11], [12, 14], [15, 16],
      [17, 19], [20, 22], [23, 24], [25, 27], [28, 30], [31, 32],
    ]);
  });

  it("is independent from fact and entrant input ordering", () => {
    const major = createGoldenMajor();
    const baseline = buildFinalMajorPlacements(major);
    const reversed = buildFinalMajorPlacements({
      tournamentTeams: [...major.tournamentTeams].reverse(),
      stage1: {
        entrants: [...major.stage1.entrants].reverse(),
        matches: [...major.stage1.matches].reverse(),
      },
      stage2: {
        entrants: [...major.stage2.entrants].reverse(),
        matches: [...major.stage2.matches].reverse(),
      },
      stage3: {
        entrants: [...major.stage3.entrants].reverse(),
        matches: [...major.stage3.matches].reverse(),
      },
      playoffMatches: [...major.playoffMatches].reverse(),
      hasThirdPlaceMatch: major.hasThirdPlaceMatch,
    });
    expect(reversed).toEqual(baseline);
  });

  it("fails closed when a completed stage is incomplete", () => {
    const major = createGoldenMajor();
    expect(() =>
      buildFinalMajorPlacements({
        ...major,
        stage2: { ...major.stage2, matches: major.stage2.matches.slice(0, -1) },
      }),
    ).toThrow(/incomplete/);
  });

  it("fails closed when a stage contains the wrong advancing cohort", () => {
    const major = createGoldenMajor();
    const advancedId = major.stage1.qualifiers[0].teamId;
    const stage1Projection = projectMajorSwissStage({
      entrants: major.stage1.entrants,
      matches: major.stage1.matches,
      finalizedRound: 5,
    });
    const eliminatedId = stage1Projection.eliminated[0].teamId;
    const replace = (teamId: string) => (teamId === advancedId ? eliminatedId : teamId);

    expect(() =>
      buildFinalMajorPlacements({
        ...major,
        stage2: {
          entrants: major.stage2.entrants.map((entrant) => ({
            ...entrant,
            teamId: replace(entrant.teamId),
          })),
          matches: major.stage2.matches.map((match) => ({
            ...match,
            entryAId: replace(match.entryAId),
            entryBId: replace(match.entryBId),
            winnerId: replace(match.winnerId),
          })),
        },
      }),
    ).toThrow(/Stage 2 advancing entrants|Stage 3 advancing entrants/);
  });
});
