import { describe, it, expect } from "vitest";
import type { Match } from "@/db/schema/matches";
import type { CompetitionEntry } from "@/db/schema/competition-entries";
import { calculateStandings } from "@/lib/standings";

function t(id: string, name: string, draftOrder: number) {
  return {
    id,
    name,
    formationOrder: draftOrder,
    competitionId: "s1",
    createdAt: new Date(),
  } as CompetitionEntry;
}

function m(id: string, entryAId: string, entryBId: string, scoreA: number, scoreB: number) {
  return {
    id,
    seasonId: "s1",
    entryAId,
    entryBId,
    stage: "qualifier",
    format: "bo1",
    status: "finished",
    scoreA,
    scoreB,
    bracketNodeId: null,
    round: null,
    entryRound: null,
    scheduledAt: null,
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Match;
}

function mapScores(...scores: [string, number, number][]) {
  return new Map(scores.map(([matchId, scoreA, scoreB]) => [matchId, [{ scoreA, scoreB }]]));
}

describe("calculateStandings", () => {
  it("uses series scores for wins and map scores for round tiebreakers", () => {
    const teams = [t("t1", "Alpha", 1), t("t2", "Bravo", 2)];
    const matches = [m("m1", "t1", "t2", 1, 0)];
    const result = calculateStandings(teams, matches, mapScores(["m1", 13, 8]));
    expect(result[0].teamName).toBe("Alpha");
    expect(result[0].wins).toBe(1);
    expect(result[0].losses).toBe(0);
    expect(result[0].netRounds).toBe(5);
    expect(result[0].totalRoundsWon).toBe(13);
    expect(result[1].wins).toBe(0);
    expect(result[1].losses).toBe(1);
    expect(result[1].netRounds).toBe(-5);
    expect(result[1].totalRoundsWon).toBe(8);
  });

  it("breaks ties with map-level net rounds before total rounds", () => {
    const teams = [t("t1", "A", 1), t("t2", "B", 2), t("t3", "C", 3)];
    const matches = [
      m("m1", "t1", "t2", 1, 0),
      m("m2", "t1", "t3", 0, 1),
      m("m3", "t2", "t3", 1, 0),
    ];
    const result = calculateStandings(
      teams,
      matches,
      mapScores(["m1", 13, 10], ["m2", 10, 13], ["m3", 13, 8]),
    );
    expect(result[0].teamName).toBe("B");
    expect(result[1].teamName).toBe("A");
    expect(result[2].teamName).toBe("C");
  });

  it("falls back to draftOrder when all else is equal", () => {
    const teams = [t("t1", "A", 3), t("t2", "B", 1)];
    const result = calculateStandings(teams, [], new Map());
    expect(result[0].draftOrder).toBe(1);
    expect(result[1].draftOrder).toBe(3);
  });

  it("assigns seeds 1-based", () => {
    const teams = [t("t1", "A", 1), t("t2", "B", 2)];
    const matches = [m("m1", "t1", "t2", 1, 0)];
    const result = calculateStandings(teams, matches, mapScores(["m1", 13, 8]));
    expect(result[0].seed).toBe(1);
    expect(result[1].seed).toBe(2);
  });
});
