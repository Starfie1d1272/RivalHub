import { describe, expect, it } from "vitest";
import {
  generateNextMajorSwissRound,
  getMajorSwissQualifiers,
  projectMajorSwissStage,
  type MajorSwissEntrant,
  type MajorSwissFinalizedRound,
  type MajorSwissMatchFact,
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
import { buildFinalMajorRanking, type MajorSwissStageFacts } from "./ranking";

interface SimulatedStage extends MajorSwissStageFacts {
  qualifiers: ReturnType<typeof getMajorSwissQualifiers>;
}

interface GoldenMajor {
  tournamentTeams: readonly MajorTournamentSeededTeam[];
  stage1: SimulatedStage;
  stage2: SimulatedStage;
  stage3: SimulatedStage;
  playoffMatches: readonly MajorPlayoffMatchFact[];
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
): SimulatedStage {
  const rng = makeRng(seed);
  const matches: MajorSwissMatchFact[] = [];

  for (let round = 1; round <= 5; round += 1) {
    const finalizedRound = (round - 1) as MajorSwissFinalizedRound;
    const pairings = generateNextMajorSwissRound({ entrants, matches, finalizedRound });
    for (let index = 0; index < pairings.length; index += 1) {
      const pairing = pairings[index];
      matches.push({
        matchId: `${label}-r${round}-m${index + 1}`,
        round: round as MajorSwissRound,
        teamAId: pairing.higherSeedTeamId,
        teamBId: pairing.lowerSeedTeamId,
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
): readonly MajorPlayoffMatchFact[] {
  const entrants = seedMajorPlayoffEntrants(stage3.qualifiers);
  const quarterfinalPairings = generateMajorPlayoffQuarterfinals(entrants);
  const quarterfinals: MajorPlayoffMatchFact[] = quarterfinalPairings.map((pairing) => ({
    matchId: `playoff-qf-${pairing.slot}`,
    round: "quarterfinal",
    slot: pairing.slot,
    teamAId: pairing.lowerSeedTeamId,
    teamBId: pairing.higherSeedTeamId,
    // Alternate upsets so the fixture exercises seed and Team A/B independence.
    winnerId: pairing.slot % 2 === 0 ? pairing.lowerSeedTeamId : pairing.higherSeedTeamId,
  }));

  const semifinals: MajorPlayoffMatchFact[] = [
    {
      matchId: "playoff-sf-1",
      round: "semifinal",
      slot: 1,
      teamAId: quarterfinals[0].winnerId,
      teamBId: quarterfinals[1].winnerId,
      winnerId: quarterfinals[1].winnerId,
    },
    {
      matchId: "playoff-sf-2",
      round: "semifinal",
      slot: 2,
      teamAId: quarterfinals[3].winnerId,
      teamBId: quarterfinals[2].winnerId,
      winnerId: quarterfinals[2].winnerId,
    },
  ];

  return [
    ...quarterfinals,
    ...semifinals,
    {
      matchId: "playoff-final",
      round: "final",
      slot: 1,
      teamAId: semifinals[1].winnerId,
      teamBId: semifinals[0].winnerId,
      winnerId: semifinals[0].winnerId,
    },
  ];
}

function createGoldenMajor(): GoldenMajor {
  const tournamentTeams: MajorTournamentSeededTeam[] = Array.from(
    { length: 32 },
    (_, index) => ({ teamId: `team-${index + 1}`, tournamentSeed: index + 1 }),
  );

  const stage1 = simulateSwissStage(
    "stage1",
    seedMajorStageOneEntrants(tournamentTeams.filter((team) => team.tournamentSeed >= 17)),
    7,
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
  );

  return {
    tournamentTeams,
    stage1,
    stage2,
    stage3,
    playoffMatches: createPlayoffMatches(stage3),
  };
}

describe("golden 32-team Major domain simulation", () => {
  it("runs the maximum 106-match path and derives a complete final 1..32 ranking", () => {
    const major = createGoldenMajor();
    const ranking = buildFinalMajorRanking(major);

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

    expect(ranking).toHaveLength(32);
    expect(ranking.map((row) => row.rank)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1),
    );
    expect(new Set(ranking.map((row) => row.teamId)).size).toBe(32);
    expect(new Set(ranking.map((row) => row.tournamentSeed)).size).toBe(32);

    expect(ranking.slice(0, 8).every((row) => row.eliminationStage === "playoff")).toBe(true);
    expect(ranking.slice(8, 16).every((row) => row.eliminationStage === "stage3")).toBe(true);
    expect(ranking.slice(16, 24).every((row) => row.eliminationStage === "stage2")).toBe(true);
    expect(ranking.slice(24, 32).every((row) => row.eliminationStage === "stage1")).toBe(true);
    expect(ranking[0].playoffPlacement).toBe("1st");
    expect(ranking[1].playoffPlacement).toBe("2nd");
    expect(ranking.slice(2, 4).map((row) => row.playoffPlacement)).toEqual(["3rd", "3rd"]);
    expect(ranking.slice(4, 8).every((row) => row.playoffPlacement === "5th")).toBe(true);
  });

  it("is independent from fact and entrant input ordering", () => {
    const major = createGoldenMajor();
    const baseline = buildFinalMajorRanking(major);
    const reversed = buildFinalMajorRanking({
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
    });
    expect(reversed).toEqual(baseline);
  });

  it("fails closed when a completed stage is incomplete", () => {
    const major = createGoldenMajor();
    expect(() =>
      buildFinalMajorRanking({
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
      buildFinalMajorRanking({
        ...major,
        stage2: {
          entrants: major.stage2.entrants.map((entrant) => ({
            ...entrant,
            teamId: replace(entrant.teamId),
          })),
          matches: major.stage2.matches.map((match) => ({
            ...match,
            teamAId: replace(match.teamAId),
            teamBId: replace(match.teamBId),
            winnerId: replace(match.winnerId),
          })),
        },
      }),
    ).toThrow(/Stage 2 advancing entrants|Stage 3 advancing entrants/);
  });
});
