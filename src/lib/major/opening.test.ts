import { describe, expect, it } from "vitest";
import { buildMajorOpeningPlan } from "./opening";
import type { MajorTournamentSeededTeam } from "./seeding";

const TOURNAMENT_TEAMS: readonly MajorTournamentSeededTeam[] = Array.from(
  { length: 32 },
  (_, index) => ({ teamId: `team-${index + 1}`, tournamentSeed: index + 1 }),
);

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function tournamentSeeds(teams: readonly MajorTournamentSeededTeam[]): number[] {
  return teams.map((team) => team.tournamentSeed);
}

describe("buildMajorOpeningPlan", () => {
  it("builds the standard 32-team entry cohorts and Stage 1 first round", () => {
    const plan = buildMajorOpeningPlan({ teams: TOURNAMENT_TEAMS, stageOneMatchFormat: "bo1" });

    expect(tournamentSeeds(plan.tournamentTeams)).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
    expect(tournamentSeeds(plan.stage3.directEntrants)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(tournamentSeeds(plan.stage2.directEntrants)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(plan.stage1.entrants.map((entrant) => entrant.tournamentSeed)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 17),
    );
    expect(plan.stage1.entrants.map((entrant) => entrant.initialStageSeed)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    expect(plan.firstRound.pairings).toEqual(
      Array.from({ length: 8 }, (_, index) => ({
        round: 1,
        higherSeed: {
          teamId: `team-${index + 17}`,
          tournamentSeed: index + 17,
          stageOneSeed: index + 1,
        },
        lowerSeed: {
          teamId: `team-${index + 25}`,
          tournamentSeed: index + 25,
          stageOneSeed: index + 9,
        },
        format: "bo1",
        pairingRule: "initial",
      })),
    );
  });

  it("is deterministic when the tournament-team input order is shuffled", () => {
    const baseline = buildMajorOpeningPlan({ teams: TOURNAMENT_TEAMS, stageOneMatchFormat: "bo1" });
    const shuffled = shuffle(TOURNAMENT_TEAMS, makeRng(73));

    expect(shuffled).not.toEqual(TOURNAMENT_TEAMS);
    expect(buildMajorOpeningPlan({ teams: shuffled, stageOneMatchFormat: "bo1" })).toEqual(baseline);
  });

  it("uses the caller-provided BO1 or BO3 format without changing pairings", () => {
    const bo1 = buildMajorOpeningPlan({ teams: TOURNAMENT_TEAMS, stageOneMatchFormat: "bo1" });
    const bo3 = buildMajorOpeningPlan({ teams: TOURNAMENT_TEAMS, stageOneMatchFormat: "bo3" });
    const withoutFormat = (pairing: (typeof bo1.firstRound.pairings)[number]) => ({
      round: pairing.round,
      higherSeed: pairing.higherSeed,
      lowerSeed: pairing.lowerSeed,
      pairingRule: pairing.pairingRule,
    });

    expect(bo1.firstRound.pairings.every((pairing) => pairing.format === "bo1")).toBe(true);
    expect(bo3.firstRound.pairings.every((pairing) => pairing.format === "bo3")).toBe(true);
    expect(bo3.firstRound.pairings.map(withoutFormat)).toEqual(
      bo1.firstRound.pairings.map(withoutFormat),
    );
  });

  it("rejects malformed complete-Major seed input and unsupported BO5 fail-closed", () => {
    const withTeam = (index: number, team: MajorTournamentSeededTeam) =>
      TOURNAMENT_TEAMS.map((current, currentIndex) => (currentIndex === index ? team : current));
    const build = (teams: readonly MajorTournamentSeededTeam[]) =>
      () => buildMajorOpeningPlan({ teams, stageOneMatchFormat: "bo1" });

    expect(build(TOURNAMENT_TEAMS.slice(0, 31))).toThrow();
    expect(build([...TOURNAMENT_TEAMS, { teamId: "team-33", tournamentSeed: 33 }])).toThrow();
    expect(build(withTeam(31, { teamId: "team-1", tournamentSeed: 32 }))).toThrow();
    expect(build(withTeam(31, { teamId: "team-32", tournamentSeed: 31 }))).toThrow();
    expect(build(withTeam(31, { teamId: "team-32", tournamentSeed: 33 }))).toThrow();
    expect(build(withTeam(0, { teamId: "team-1", tournamentSeed: 0 }))).toThrow();
    expect(build(withTeam(0, { teamId: "team-1", tournamentSeed: -1 }))).toThrow();
    expect(build(withTeam(0, { teamId: "team-1", tournamentSeed: 1.5 }))).toThrow();
    expect(build(withTeam(0, { teamId: "", tournamentSeed: 1 }))).toThrow();
    expect(() => buildMajorOpeningPlan({ teams: TOURNAMENT_TEAMS, stageOneMatchFormat: "bo5" })).toThrow(
      "Major Swiss stages do not support bo5 matchFormat",
    );
  });

  it("does not mutate the caller-owned array or team objects", () => {
    const teams = TOURNAMENT_TEAMS.map((team) => ({ ...team }));
    const snapshot = structuredClone(teams);

    buildMajorOpeningPlan({ teams, stageOneMatchFormat: "bo1" });

    expect(teams).toEqual(snapshot);
  });
});
