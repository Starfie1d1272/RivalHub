import { describe, expect, it } from "vitest";

import { calculateStandings } from "@/lib/standings";
import type { CompetitionEntry } from "@/db/schema/competition-entries";
import type { Match } from "@/db/schema/matches";

function makeTeam(id: string, name: string, draftOrder: number): CompetitionEntry {
  return { id, name, competitionId: "s1", formationOrder: draftOrder } as unknown as CompetitionEntry;
}

function fm(overrides: Record<string, unknown> = {}): Match {
  return {
    id: "m",
    seasonId: "s1",
    stage: "qualifier",
    status: "finished",
    entryAId: "t1",
    entryBId: "t2",
    scoreA: 1,
    scoreB: 0,
    format: "bo1",
    round: null,
    entryRound: null,
    bracketNodeId: null,
    scheduledAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Match;
}

function mapScores(...scores: [string, number, number][]) {
  return new Map(scores.map(([matchId, scoreA, scoreB]) => [matchId, [{ scoreA, scoreB }]]));
}

describe("calculateStandings", () => {
  it("uses series scores for wins/losses and match_maps for rounds", () => {
    const finishedMatches = [fm({ id: "m1", entryAId: "t1", entryBId: "t2", scoreA: 1, scoreB: 0 })];
    const teams = [makeTeam("t1", "A队", 1), makeTeam("t2", "B队", 2)];
    const standings = calculateStandings(teams, finishedMatches, mapScores(["m1", 13, 8]));
    expect(standings[0].teamId).toBe("t1");
    expect(standings[0].wins).toBe(1);
    expect(standings[0].losses).toBe(0);
    expect(standings[0].netRounds).toBe(5);
    expect(standings[0].totalRoundsWon).toBe(13);
    expect(standings[1].wins).toBe(0);
    expect(standings[1].losses).toBe(1);
  });

  it("prioritizes wins, then map-level net rounds", () => {
    const finishedMatches = [
      fm({ id: "m1", entryAId: "t1", entryBId: "t2", scoreA: 1, scoreB: 0 }),
      fm({ id: "m2", entryAId: "t1", entryBId: "t3", scoreA: 1, scoreB: 0 }),
      fm({ id: "m3", entryAId: "t2", entryBId: "t3", scoreA: 1, scoreB: 0 }),
    ];
    const teams = [makeTeam("t1", "A队", 1), makeTeam("t2", "B队", 2), makeTeam("t3", "C队", 3)];
    const standings = calculateStandings(
      teams,
      finishedMatches,
      mapScores(["m1", 13, 11], ["m2", 13, 10], ["m3", 13, 1]),
    );
    expect(standings[0].teamId).toBe("t1");
    expect(standings[0].wins).toBe(2);
    expect(standings[2].teamId).toBe("t3");
    expect(standings[2].losses).toBe(2);
  });

  it("uses total map rounds and head-to-head only after wins/net rounds", () => {
    const finishedMatches = [
      fm({ id: "m1", entryAId: "t1", entryBId: "t2", scoreA: 1, scoreB: 0 }),
      fm({ id: "m2", entryAId: "t1", entryBId: "t3", scoreA: 0, scoreB: 1 }),
      fm({ id: "m3", entryAId: "t2", entryBId: "t3", scoreA: 1, scoreB: 0 }),
    ];
    const teams = [makeTeam("t1", "A队", 1), makeTeam("t2", "B队", 2), makeTeam("t3", "C队", 3)];
    const standings = calculateStandings(
      teams,
      finishedMatches,
      mapScores(["m1", 13, 11], ["m2", 8, 13], ["m3", 13, 8]),
    );
    expect(standings[0].teamId).toBe("t2");
    expect(standings[1].teamId).toBe("t3");
    expect(standings[2].teamId).toBe("t1");
  });

  it("falls back to draftOrder when there are no completed matches", () => {
    const teams = [makeTeam("t2", "B队", 2), makeTeam("t1", "A队", 1)];
    const standings = calculateStandings(teams, [], new Map());
    expect(standings[0].teamId).toBe("t1");
    expect(standings[0].seed).toBe(1);
    expect(standings[1].teamId).toBe("t2");
    expect(standings[1].seed).toBe(2);
  });
});
