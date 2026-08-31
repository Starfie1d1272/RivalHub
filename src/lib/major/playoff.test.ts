import { describe, expect, it } from "vitest";
import {
  generateMajorPlayoffQuarterfinals,
  projectMajorPlayoff,
  seedMajorPlayoffEntrants,
  type MajorPlayoffEntrant,
  type MajorPlayoffMatchFact,
} from "./playoff";

const ENTRANTS: MajorPlayoffEntrant[] = Array.from({ length: 8 }, (_, index) => ({
  teamId: `team-${index + 1}`,
  playoffSeed: index + 1,
}));

const COMPLETE_MATCHES: MajorPlayoffMatchFact[] = [
  { matchId: "qf-1", round: "quarterfinal", slot: 1, entryAId: "team-1", entryBId: "team-8", winnerId: "team-1" },
  { matchId: "qf-2", round: "quarterfinal", slot: 2, entryAId: "team-5", entryBId: "team-4", winnerId: "team-5" },
  { matchId: "qf-3", round: "quarterfinal", slot: 3, entryAId: "team-2", entryBId: "team-7", winnerId: "team-7" },
  { matchId: "qf-4", round: "quarterfinal", slot: 4, entryAId: "team-6", entryBId: "team-3", winnerId: "team-3" },
  { matchId: "sf-1", round: "semifinal", slot: 1, entryAId: "team-5", entryBId: "team-1", winnerId: "team-1" },
  { matchId: "sf-2", round: "semifinal", slot: 2, entryAId: "team-3", entryBId: "team-7", winnerId: "team-7" },
  { matchId: "f-1", round: "final", slot: 1, entryAId: "team-7", entryBId: "team-1", winnerId: "team-1" },
];

const THIRD_PLACE_MATCH: MajorPlayoffMatchFact = {
  matchId: "third-place-1",
  round: "third_place",
  slot: 1,
  entryAId: "team-3",
  entryBId: "team-5",
  winnerId: "team-3",
};

describe("Major playoff seeding", () => {
  it("normalizes shuffled Stage 3 qualifiers to seeds 1..8", () => {
    const seeded = seedMajorPlayoffEntrants(
      [...ENTRANTS]
        .reverse()
        .map((entrant) => ({ teamId: entrant.teamId, finalStageSeed: entrant.playoffSeed })),
    );
    expect(seeded).toEqual(ENTRANTS);
  });

  it("generates the official 1v8, 4v5, 2v7, 3v6 bracket order", () => {
    expect(generateMajorPlayoffQuarterfinals([...ENTRANTS].reverse())).toEqual([
      { round: "quarterfinal", slot: 1, higherSeedTeamId: "team-1", lowerSeedTeamId: "team-8", higherSeed: 1, lowerSeed: 8 },
      { round: "quarterfinal", slot: 2, higherSeedTeamId: "team-4", lowerSeedTeamId: "team-5", higherSeed: 4, lowerSeed: 5 },
      { round: "quarterfinal", slot: 3, higherSeedTeamId: "team-2", lowerSeedTeamId: "team-7", higherSeed: 2, lowerSeed: 7 },
      { round: "quarterfinal", slot: 4, higherSeedTeamId: "team-3", lowerSeedTeamId: "team-6", higherSeed: 3, lowerSeed: 6 },
    ]);
  });

  it("rejects duplicate, missing, and out-of-range playoff seeds", () => {
    expect(() => seedMajorPlayoffEntrants(ENTRANTS.slice(0, 7).map((e) => ({ teamId: e.teamId, finalStageSeed: e.playoffSeed })))).toThrow();

    const duplicate = ENTRANTS.map((e) => ({ teamId: e.teamId, finalStageSeed: e.playoffSeed }));
    duplicate[7] = { ...duplicate[7], finalStageSeed: 1 };
    expect(() => seedMajorPlayoffEntrants(duplicate)).toThrow(/duplicate finalStageSeed/);

    const invalid = ENTRANTS.map((e) => ({ teamId: e.teamId, finalStageSeed: e.playoffSeed }));
    invalid[7] = { ...invalid[7], finalStageSeed: 9 };
    expect(() => seedMajorPlayoffEntrants(invalid)).toThrow(/1\.\.8/);
  });
});

describe("Major playoff projection", () => {
  it("derives champion and elimination tiers from canonical match facts", () => {
    expect(projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: [...COMPLETE_MATCHES].reverse(),
      hasThirdPlaceMatch: false,
    })).toEqual({
      championId: "team-1",
      runnerUpId: "team-7",
      thirdPlaceId: null,
      fourthPlaceId: null,
      semifinalLoserIds: ["team-5", "team-3"],
      quarterfinalLoserIds: ["team-8", "team-4", "team-2", "team-6"],
    });
  });

  it("accepts Team A/B orientation independently from bracket seed", () => {
    const reversed = COMPLETE_MATCHES.map((match) => ({
      ...match,
      entryAId: match.entryBId,
      entryBId: match.entryAId,
    }));
    expect(projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: reversed,
      hasThirdPlaceMatch: false,
    }).championId).toBe("team-1");
  });

  it("rejects incomplete, duplicate-slot, and impossible downstream facts", () => {
    expect(() => projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: COMPLETE_MATCHES.slice(0, 6),
      hasThirdPlaceMatch: false,
    })).toThrow(/exactly 7/);

    const duplicateSlot = COMPLETE_MATCHES.map((match) => ({ ...match }));
    duplicateSlot[1].slot = 1;
    expect(() => projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: duplicateSlot,
      hasThirdPlaceMatch: false,
    })).toThrow(/duplicate slot/);

    const impossibleSemifinal = COMPLETE_MATCHES.map((match) => ({ ...match }));
    impossibleSemifinal[4] = { ...impossibleSemifinal[4], entryAId: "team-8" };
    expect(() => projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: impossibleSemifinal,
      hasThirdPlaceMatch: false,
    })).toThrow(/invalid participants/);

    const duplicateId = COMPLETE_MATCHES.map((match) => ({ ...match }));
    duplicateId[1].matchId = duplicateId[0].matchId;
    expect(() => projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: duplicateId,
      hasThirdPlaceMatch: false,
    })).toThrow(/duplicate playoff matchId/);

    const invalidWinner = COMPLETE_MATCHES.map((match) => ({ ...match }));
    invalidWinner[0].winnerId = "team-3";
    expect(() => projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: invalidWinner,
      hasThirdPlaceMatch: false,
    })).toThrow(/winnerId must be a participant/);
  });

  it("rejects a third-place match when the format omits it", () => {
    expect(() => projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: [...COMPLETE_MATCHES, THIRD_PLACE_MATCH],
      hasThirdPlaceMatch: false,
    })).toThrow(/exactly 7/);
  });

  it("requires and derives the third-place match when configured", () => {
    expect(() => projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: COMPLETE_MATCHES,
      hasThirdPlaceMatch: true,
    })).toThrow(/exactly 8/);

    expect(projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: [...COMPLETE_MATCHES, THIRD_PLACE_MATCH],
      hasThirdPlaceMatch: true,
    })).toMatchObject({
      championId: "team-1",
      runnerUpId: "team-7",
      thirdPlaceId: "team-3",
      fourthPlaceId: "team-5",
    });
  });

  it("rejects third-place facts that do not use both semifinal losers", () => {
    expect(() => projectMajorPlayoff({
      entrants: ENTRANTS,
      matches: [...COMPLETE_MATCHES, {
        ...THIRD_PLACE_MATCH,
        entryAId: "team-8",
        winnerId: "team-5",
      }],
      hasThirdPlaceMatch: true,
    })).toThrow(/invalid participants/);
  });
});
