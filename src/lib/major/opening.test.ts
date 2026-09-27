import { describe, expect, it } from "vitest";
import { createMajor24Capabilities, createMajorDefaultCapabilities } from "@/lib/competition/templates";
import { buildMajorOpeningPlan } from "./opening";
import type { MajorTournamentSeededTeam } from "./seeding";

function teams(capacity: number): readonly MajorTournamentSeededTeam[] {
  return Array.from({ length: capacity }, (_, index) => ({ teamId: `team-${index + 1}`, tournamentSeed: index + 1 }));
}

function shuffle<T>(items: readonly T[]): T[] {
  return [...items].reverse();
}

describe("buildMajorOpeningPlan", () => {
  it("keeps the standard 32-team cohorts and BO1 first round", () => {
    const stagePlan = createMajorDefaultCapabilities().stagePlan;
    const plan = buildMajorOpeningPlan({ teams: teams(32), stagePlan });

    expect(plan.profile).toEqual({ id: "major-32", entrantCapacity: 32 });
    expect(plan.entryCohorts.map(({ stageName, fromSeed, toSeed }) => [stageName, fromSeed, toSeed])).toEqual([
      ["阶段三", 1, 8], ["阶段二", 9, 16], ["阶段一", 17, 32],
    ]);
    expect(plan.stage1.entrants.map((entrant) => entrant.tournamentSeed)).toEqual(Array.from({ length: 16 }, (_, index) => index + 17));
    expect(plan.stage1.entrants.map((entrant) => entrant.initialStageSeed)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    expect(plan.firstRound.pairings).toHaveLength(8);
    expect(plan.firstRound.pairings.every((pairing) => pairing.format === "bo1")).toBe(true);
  });

  it("builds Major-24 seeds 9–24 into Stage 1 and previews eight BO3 matches", () => {
    const plan = buildMajorOpeningPlan({ teams: teams(24), stagePlan: createMajor24Capabilities().stagePlan });

    expect(plan.profile).toEqual({ id: "major-24", entrantCapacity: 24 });
    expect(plan.entryCohorts.map(({ stageName, fromSeed, toSeed }) => [stageName, fromSeed, toSeed])).toEqual([
      ["阶段二", 1, 8], ["阶段一", 9, 24],
    ]);
    expect(plan.stage1.entrants.map((entrant) => entrant.tournamentSeed)).toEqual(Array.from({ length: 16 }, (_, index) => index + 9));
    expect(plan.firstRound.pairings).toHaveLength(8);
    expect(plan.firstRound.pairings.every((pairing) => pairing.format === "bo3")).toBe(true);
  });

  it("is deterministic when tournament entrants are shuffled", () => {
    const source = teams(24);
    const stagePlan = createMajor24Capabilities().stagePlan;
    expect(buildMajorOpeningPlan({ teams: shuffle(source), stagePlan }))
      .toEqual(buildMajorOpeningPlan({ teams: source, stagePlan }));
  });

  it("rejects malformed seeds, wrong capacities, unsupported profiles, and Swiss BO5", () => {
    const source = teams(24);
    const stagePlan = createMajor24Capabilities().stagePlan;
    expect(() => buildMajorOpeningPlan({ teams: source.slice(0, 23), stagePlan })).toThrow("exactly 24 teams");
    expect(() => buildMajorOpeningPlan({ teams: teams(32), stagePlan })).toThrow("exactly 24 teams");
    expect(() => buildMajorOpeningPlan({ teams: source.map((team, index) => index === 23 ? { ...team, tournamentSeed: 25 } : team), stagePlan })).toThrow();
    const unsupported = structuredClone(stagePlan);
    unsupported[0]!.matchFormat = "bo1";
    expect(() => buildMajorOpeningPlan({ teams: source, stagePlan: unsupported })).toThrow("supported managed Major stage plan");
    const bo5 = structuredClone(stagePlan);
    bo5[0]!.matchFormat = "bo5";
    expect(() => buildMajorOpeningPlan({ teams: source, stagePlan: bo5 })).toThrow("supported managed Major stage plan");
  });

  it("does not mutate the caller-owned teams", () => {
    const source = teams(24).map((team) => ({ ...team }));
    const snapshot = structuredClone(source);
    buildMajorOpeningPlan({ teams: source, stagePlan: createMajor24Capabilities().stagePlan });
    expect(source).toEqual(snapshot);
  });
});
