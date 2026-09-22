import { describe, expect, it } from "vitest";
import { buildTournamentResults } from "./results";

describe("buildTournamentResults", () => {
  it("keeps played-map exposure independent from confirmed DAK coverage", () => {
    const result = buildTournamentResults([
      { id: "match-1", entryAId: "a", entryBId: "b", scoreA: 2, scoreB: 1, status: "finished" },
      { id: "match-2", entryAId: "a", entryBId: "b", scoreA: 0, scoreB: 2, status: "finished" },
    ], [
      ...Array.from({ length: 7 }, (_, index) => ({
        matchId: index < 4 ? "match-1" : "match-2",
        mapName: "de_ancient",
        scoreA: index < 4 ? 13 : 8,
        scoreB: index < 4 ? 7 : 13,
        completedAt: new Date("2026-01-01T00:00:00Z"),
      })),
    ], [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Bravo" },
    ]);

    expect(result.totals).toEqual({ completedMatches: 2, completedMaps: 7, completedRounds: 143 });
    expect(result.maps).toEqual([{ mapName: "de_ancient", played: 7 }]);
    expect(result.teams.find((team) => team.entryId === "a")).toMatchObject({ matches: 2, matchWins: 1, matchLosses: 1, maps: 7 });
  });

  it("excludes incomplete maps and unfinished match results", () => {
    const result = buildTournamentResults([
      { id: "match-1", entryAId: "a", entryBId: "b", scoreA: 0, scoreB: 0, status: "in_progress" },
    ], [
      { matchId: "match-1", mapName: "de_ancient", scoreA: 12, scoreB: 12, completedAt: null },
    ], [{ id: "a", name: "Alpha" }, { id: "b", name: "Bravo" }]);

    expect(result.totals).toEqual({ completedMatches: 0, completedMaps: 0, completedRounds: 0 });
    expect(result.teams).toEqual([]);
    expect(result.maps).toEqual([]);
  });
});
